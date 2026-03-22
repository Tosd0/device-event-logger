# Hono Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the monolithic `main.ts` into a modular Hono application with multi-platform entry files.

**Architecture:** Extract code from a single 666-line `main.ts` into focused modules under `src/` (types, lib, middleware, routes) and thin entry files under `entry/`. The Hono app is created via a `createApp()` factory. All business logic is preserved identically — this is a structural refactor only.

**Tech Stack:** Hono (jsr:@hono/hono), postgresjs, Deno, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-22-hono-refactor-design.md`

**Testing strategy:** This project uses `test.sh` (curl-based integration tests) as its test suite. After each task that produces a runnable state, verify with `test.sh`. No unit test framework is in use.

---

### Task 1: Update `deno.json` with Hono dependency and tasks

**Files:**
- Modify: `deno.json`

- [ ] **Step 1: Update deno.json**

```json
{
  "imports": {
    "hono": "jsr:@hono/hono",
    "hono/cors": "jsr:@hono/hono/cors",
    "postgres": "https://deno.land/x/postgresjs@v3.4.8/mod.js"
  },
  "tasks": {
    "dev": "deno run --allow-net --allow-env --allow-read entry/deno.ts",
    "start": "deno run --allow-net --allow-env entry/deno.ts"
  }
}
```

- [ ] **Step 2: Verify Hono resolves**

Run: `cd /Users/tntobsidian/Documents/GitHub/device-event-logger && deno eval "import { Hono } from 'hono'; console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add deno.json
git commit -m "chore: add hono dependency and deno tasks"
```

---

### Task 2: Create shared types (`src/types.ts`)

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create types file**

Extract all shared types from `main.ts`. These are used across multiple modules.

```ts
import type postgres from "postgres";

export type Env = {
  API_KEY: string;
  DATABASE_URL: string;
  TZ_OFFSET?: string;
};

export type Vars = {
  sql: postgres.Sql;
  offsetMinutes: number;
};

export type EventRecord = {
  id: number;
  type: string;
  value: string | null;
  ts: string | null;
};

export type EventQuery = {
  since: Date;
  until: Date;
  type?: string;
  value?: string;
  limit: number;
  offset: number;
};

export type JsonRpcId = string | number | null;
export type JsonRpcMessage = Record<string, unknown>;
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check src/types.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

### Task 3: Create timezone utility (`src/lib/timezone.ts`)

**Files:**
- Create: `src/lib/timezone.ts`

- [ ] **Step 1: Create timezone module**

Extract `formatUtcPlus8` from `main.ts:151-166` and parameterize by offset. Add `parseOffsetEnv` for env var parsing.

```ts
export function parseOffsetEnv(raw?: string): number {
  if (raw == null || raw.trim() === "") return 480;
  const hours = Number(raw);
  if (!Number.isFinite(hours)) return 480;
  const minutes = Math.round(hours * 60);
  if (minutes < -720 || minutes > 840) return 480;
  return minutes;
}

export function formatWithOffset(input: unknown, offsetMinutes: number): string | null {
  if (input == null) return null;
  const date = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(date.getTime())) return null;

  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  const second = String(shifted.getUTCSeconds()).padStart(2, "0");
  const millisecond = String(shifted.getUTCMilliseconds()).padStart(3, "0");

  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}${sign}${hh}:${mm}`;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check src/lib/timezone.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/timezone.ts
git commit -m "feat: add parameterized timezone formatting"
```

---

### Task 4: Create database utilities (`src/lib/db.ts`)

**Files:**
- Create: `src/lib/db.ts`

- [ ] **Step 1: Create db module**

Extract `sleep`, `withRetry`, and add `createSql` factory from `main.ts:6,168-185`.

```ts
import postgres from "postgres";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 20000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("the database system is starting up") && i < retries - 1) {
        console.log(`DB cold start, retrying in ${delayMs / 1000}s... (${i + 1}/${retries})`);
        await sleep(delayMs);
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

export function createSql(databaseUrl: string, options?: Record<string, unknown>): postgres.Sql {
  return postgres(databaseUrl, { max: 1, ...options });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check src/lib/db.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: add database connection factory and retry logic"
```

---

### Task 5: Create query logic (`src/lib/queries.ts`)

**Files:**
- Create: `src/lib/queries.ts`

- [ ] **Step 1: Create queries module**

Extract from `main.ts:240-381`: `parseEventQuery`, `parseEventQueryFromUrl`, `parseEventQueryFromToolArgs`, `queryEvents`, `buildEventSummaryText`. Key changes from original:
- `queryEvents` takes `sql` and `offsetMinutes` as parameters instead of using module-level globals
- `parseEventQueryFromUrl` returns `{ error: string }` instead of `Response` (Hono handlers will convert to `c.json()`)
- Uses `formatWithOffset` from `lib/timezone.ts`
- Uses `withRetry` from `lib/db.ts`

```ts
import type postgres from "postgres";
import type { EventQuery, EventRecord } from "../types.ts";
import { formatWithOffset } from "./timezone.ts";
import { withRetry } from "./db.ts";

export function parseEventQueryFromUrl(url: URL): EventQuery | { error: string } {
  return parseEventQuery({
    hours: url.searchParams.get("hours") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
    until: url.searchParams.get("until") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    value: url.searchParams.get("value") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  }, false);
}

export function parseEventQueryFromToolArgs(args: Record<string, unknown>): EventQuery | string {
  const result = parseEventQuery(args, true);
  if (typeof result === "string") return result;
  return result as EventQuery;
}

export function parseEventQuery(
  input: Record<string, unknown>,
  allowDefaultHours: boolean,
): EventQuery | { error: string } | string {
  const rawHours = input.hours;
  const rawSince = input.since;
  const rawUntil = input.until;
  const rawType = input.type;
  const rawValue = input.value;
  const rawLimit = input.limit;
  const rawOffset = input.offset;

  const fail = (message: string) => allowDefaultHours ? message : { error: message };

  let since: Date;
  if (rawHours != null && rawHours !== "") {
    const hours = Number(rawHours);
    if (!Number.isFinite(hours) || hours <= 0) return fail("Invalid 'hours'");
    since = new Date(Date.now() - hours * 3600_000);
  } else if (rawSince != null && String(rawSince).trim()) {
    since = new Date(String(rawSince));
    if (Number.isNaN(since.getTime())) return fail("Invalid 'since' format");
  } else if (allowDefaultHours) {
    since = new Date(Date.now() - 6 * 3600_000);
  } else {
    return fail("Provide 'hours' or 'since'");
  }

  let until: Date;
  if (rawUntil != null && String(rawUntil).trim()) {
    until = new Date(String(rawUntil));
    if (Number.isNaN(until.getTime())) return fail("Invalid 'until' format");
  } else {
    until = new Date();
  }

  if (until.getTime() < since.getTime()) {
    return fail("'until' must be greater than or equal to 'since'");
  }

  const type = rawType == null || String(rawType).trim() === "" ? undefined : String(rawType).trim();
  const value = rawValue == null || String(rawValue).trim() === "" ? undefined : String(rawValue);

  const limitNumber = rawLimit == null || rawLimit === "" ? 100 : Number(rawLimit);
  if (!Number.isFinite(limitNumber) || limitNumber < 1) return fail("Invalid 'limit'");
  const limit = Math.min(Math.floor(limitNumber), 1000);

  const offsetNumber = rawOffset == null || rawOffset === "" ? 0 : Number(rawOffset);
  if (!Number.isFinite(offsetNumber) || offsetNumber < 0) return fail("Invalid 'offset'");
  const offset = Math.floor(offsetNumber);

  return { since, until, type, value, limit, offset };
}

export async function queryEvents(
  query: EventQuery,
  sql: postgres.Sql,
  offsetMinutes: number,
): Promise<{ events: EventRecord[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  conditions.push(`ts >= $${paramIndex++}`);
  values.push(query.since.toISOString());
  conditions.push(`ts <= $${paramIndex++}`);
  values.push(query.until.toISOString());

  if (query.type) {
    if (query.type.includes(".")) {
      conditions.push(`type = $${paramIndex++}`);
      values.push(query.type);
    } else {
      conditions.push(`(type = $${paramIndex} OR type LIKE $${paramIndex + 1})`);
      values.push(query.type, `${query.type}.%`);
      paramIndex += 2;
    }
  }

  if (query.value) {
    conditions.push(`value = $${paramIndex++}`);
    values.push(query.value);
  }

  const where = conditions.join(" AND ");
  const limitIdx = paramIndex++;
  const offsetIdx = paramIndex++;
  values.push(query.limit, query.offset);

  const [countResult, rows] = await withRetry(async () => {
    const c = await sql.unsafe(
      `SELECT COUNT(*)::int AS total FROM events WHERE ${where}`,
      values.slice(0, -2),
    );
    const r = await sql.unsafe(
      `SELECT id, type, value, ts FROM events WHERE ${where} ORDER BY ts ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values,
    );
    return [c, r] as const;
  });

  const events = rows.map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    type: String(r.type ?? ""),
    value: r.value == null ? null : String(r.value),
    ts: formatWithOffset(r.ts, offsetMinutes),
  }));

  return {
    events,
    total: Number(countResult[0].total ?? 0),
  };
}

export function buildEventSummaryText(events: EventRecord[], total: number): string {
  if (!events.length) {
    return `Found 0 events. Total matches: ${total}.`;
  }

  const lines = events.map((event) => {
    const time = event.ts ? event.ts.replace("T", " ").slice(0, 16) : "unknown-time";
    const detail = event.value ? ` (value=${event.value})` : "";
    return `- [${time}] ${event.type}${detail}`;
  });

  return [
    `Found ${events.length} event(s). Total matches: ${total}.`,
    ...lines,
  ].join("\n");
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check src/lib/queries.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries.ts
git commit -m "feat: add shared query parsing and execution logic"
```

---

### Task 6: Create MCP protocol module (`src/lib/mcp-protocol.ts`)

**Files:**
- Create: `src/lib/mcp-protocol.ts`

- [ ] **Step 1: Create MCP protocol module**

Extract from `main.ts:15-27,28-119,195-550`. Contains all MCP constants, JSON-RPC helpers, tool definitions, and the `handleMcpPost` Hono handler. Key changes:
- `handleMcpRequest` takes `sql` and `offsetMinutes` as parameters
- `handleMcpPost` is a Hono handler that uses `c.var.sql`, `c.var.offsetMinutes`, `c.req`, `c.json()`, `c.header()`, `c.body(null, 202)`
- `callQueryEventsTool` and `callListEventTypesTool` take `sql` and `offsetMinutes` as parameters
- Uses `queryEvents`, `parseEventQueryFromToolArgs`, `buildEventSummaryText` from `lib/queries.ts`
- Uses `withRetry` from `lib/db.ts`

```ts
import type { Context } from "hono";
import type postgres from "postgres";
import type { Env, Vars, JsonRpcId, JsonRpcMessage } from "../types.ts";
import { queryEvents, parseEventQueryFromToolArgs, buildEventSummaryText } from "./queries.ts";
import { withRetry } from "./db.ts";

const DEFAULT_MCP_PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
]);

const MCP_SERVER_INFO = {
  name: "device-event-logger",
  title: "User Device Event Logger",
  version: "1.0.0",
  description: "Query user device event records from a database. Read-only.",
};

const QUERY_EVENTS_TOOL = {
  name: "query_events",
  title: "Query Events",
  description: "Query event records by time range, type, and value.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      hours: { type: "number", description: "Look back N hours. Defaults to 6 when since is omitted.", minimum: 0.001 },
      since: { type: "string", description: "Start time in ISO 8601 format. Overrides the default hours window." },
      until: { type: "string", description: "End time in ISO 8601 format. Defaults to now." },
      type: { type: "string", description: "Event type filter (dot-separated lowercase alphanumeric, e.g. 'app.open'). Prefix match when no dot is present; exact match otherwise. Use the list_event_types tool to discover available types." },
      value: { type: "string", description: "Exact value filter." },
      limit: { type: "integer", description: "Maximum number of events to return. Default 100, max 1000.", minimum: 1, maximum: 1000 },
      offset: { type: "integer", description: "Pagination offset. Default 0.", minimum: 0 },
    },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      total: { type: "integer" },
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer" },
            type: { type: "string" },
            value: { anyOf: [{ type: "string" }, { type: "null" }] },
            ts: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          required: ["id", "type", "value", "ts"],
        },
      },
    },
    required: ["total", "events"],
  },
};

const LIST_EVENT_TYPES_TOOL = {
  name: "list_event_types",
  title: "List Event Types",
  description: "List all distinct event types currently stored in the database. Use this to discover available types before querying events.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { types: { type: "array", items: { type: "string" } } },
    required: ["types"],
  },
};

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function isJsonRpcRequest(message: JsonRpcMessage): boolean {
  return typeof message.method === "string" && Object.prototype.hasOwnProperty.call(message, "id");
}

function isJsonRpcNotification(message: JsonRpcMessage): boolean {
  return typeof message.method === "string" && !Object.prototype.hasOwnProperty.call(message, "id");
}

function isJsonRpcResponse(message: JsonRpcMessage): boolean {
  return Object.prototype.hasOwnProperty.call(message, "result") ||
    Object.prototype.hasOwnProperty.call(message, "error");
}

function getProtocolVersionFromHeaders(c: Context): string {
  const header = c.req.header("mcp-protocol-version")?.trim();
  return header || DEFAULT_MCP_PROTOCOL_VERSION;
}

async function callQueryEventsTool(args: Record<string, unknown>, sql: postgres.Sql, offsetMinutes: number) {
  const parsed = parseEventQueryFromToolArgs(args);
  if (typeof parsed === "string") {
    return { content: [{ type: "text", text: parsed }], isError: true };
  }
  try {
    const result = await queryEvents(parsed, sql, offsetMinutes);
    return {
      content: [{ type: "text", text: buildEventSummaryText(result.events, result.total) }],
      structuredContent: result,
      isError: false,
    };
  } catch (error) {
    console.error("MCP query_events failed:", error);
    return { content: [{ type: "text", text: "Database error while querying events." }], isError: true };
  }
}

async function callListEventTypesTool(sql: postgres.Sql) {
  try {
    const rows = await withRetry(() =>
      sql.unsafe("SELECT DISTINCT type FROM events ORDER BY type")
    );
    const types = rows.map((r: Record<string, unknown>) => String(r.type));
    return {
      content: [{ type: "text", text: types.length ? types.join("\n") : "No event types found." }],
      structuredContent: { types },
      isError: false,
    };
  } catch (error) {
    console.error("MCP list_event_types failed:", error);
    return { content: [{ type: "text", text: "Database error while listing event types." }], isError: true };
  }
}

async function handleMcpRequest(message: JsonRpcMessage, sql: postgres.Sql, offsetMinutes: number) {
  const id = (message.id ?? null) as JsonRpcId;
  const method = typeof message.method === "string" ? message.method : "";
  const params = (message.params && typeof message.params === "object")
    ? message.params as Record<string, unknown>
    : {};

  switch (method) {
    case "initialize": {
      const requestedVersion = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      if (!requestedVersion || !SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requestedVersion)) {
        return jsonRpcError(id, -32602, "Unsupported protocolVersion", {
          supported: Array.from(SUPPORTED_MCP_PROTOCOL_VERSIONS),
        });
      }
      return jsonRpcResult(id, {
        protocolVersion: requestedVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: "This server provides read-only access to user device event records. Use list_event_types to discover available event types, then use query_events to query records by time range, type, and value.",
      });
    }
    case "notifications/initialized":
      return null;
    case "ping":
      return jsonRpcResult(id, {});
    case "tools/list":
      return jsonRpcResult(id, { tools: [QUERY_EVENTS_TOOL, LIST_EVENT_TYPES_TOOL] });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (name === LIST_EVENT_TYPES_TOOL.name) {
        return jsonRpcResult(id, await callListEventTypesTool(sql));
      }
      if (name !== QUERY_EVENTS_TOOL.name) {
        return jsonRpcError(id, -32601, `Unknown tool: ${name || "(empty)"}`);
      }
      const args = (params.arguments && typeof params.arguments === "object")
        ? params.arguments as Record<string, unknown>
        : {};
      return jsonRpcResult(id, await callQueryEventsTool(args, sql, offsetMinutes));
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method || "(empty)"}`);
  }
}

export async function handleMcpPost(c: Context<{ Bindings: Env; Variables: Vars }>): Promise<Response> {
  const sql = c.var.sql;
  const offsetMinutes = c.var.offsetMinutes;

  // Validate protocol version header
  const version = c.req.header("mcp-protocol-version")?.trim();
  if (version && !SUPPORTED_MCP_PROTOCOL_VERSIONS.has(version)) {
    return c.json({ error: `Unsupported MCP protocol version: ${version}` }, 400);
  }

  const protocolVersion = getProtocolVersionFromHeaders(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    c.header("MCP-Protocol-Version", protocolVersion);
    return c.json(jsonRpcError(null, -32700, "Parse error"), 400);
  }

  // Batch handling — array of JSON-RPC messages
  if (Array.isArray(body)) {
    if (!body.length) {
      c.header("MCP-Protocol-Version", protocolVersion);
      return c.json(jsonRpcError(null, -32600, "Invalid Request"), 400);
    }
    const responses: unknown[] = [];
    for (const item of body) {
      if (!item || typeof item !== "object") {
        responses.push(jsonRpcError(null, -32600, "Invalid Request"));
        continue;
      }
      const message = item as JsonRpcMessage;
      if (isJsonRpcNotification(message) || isJsonRpcResponse(message)) continue;
      if (!isJsonRpcRequest(message)) {
        responses.push(jsonRpcError(null, -32600, "Invalid Request"));
        continue;
      }
      responses.push(await handleMcpRequest(message, sql, offsetMinutes));
    }
    if (!responses.length) {
      return c.body(null, 202);
    }
    c.header("MCP-Protocol-Version", protocolVersion);
    return c.json(responses);
  }

  // Single message handling
  if (!body || typeof body !== "object") {
    c.header("MCP-Protocol-Version", protocolVersion);
    return c.json(jsonRpcError(null, -32600, "Invalid Request"), 400);
  }
  const message = body as JsonRpcMessage;
  if (isJsonRpcNotification(message) || isJsonRpcResponse(message)) {
    return c.body(null, 202);
  }
  if (!isJsonRpcRequest(message)) {
    c.header("MCP-Protocol-Version", protocolVersion);
    return c.json(jsonRpcError(null, -32600, "Invalid Request"), 400);
  }
  const response = await handleMcpRequest(message, sql, offsetMinutes);
  if (response == null) {
    return c.body(null, 202);
  }
  c.header("MCP-Protocol-Version", protocolVersion);
  return c.json(response);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check src/lib/mcp-protocol.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcp-protocol.ts
git commit -m "feat: add MCP protocol module with JSON-RPC handling"
```

---

### Task 7: Create middleware (`src/middleware/cors.ts`, `src/middleware/auth.ts`)

**Files:**
- Create: `src/middleware/cors.ts`
- Create: `src/middleware/auth.ts`

- [ ] **Step 1: Create CORS middleware**

```ts
import { cors } from "hono/cors";

export const corsMiddleware = cors({
  origin: "*",
  allowHeaders: ["Authorization", "Content-Type", "MCP-Protocol-Version"],
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
});
```

- [ ] **Step 2: Create auth middleware**

```ts
import type { Context, Next } from "hono";
import type { Env, Vars } from "../types.ts";

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Vars }>,
  next: Next,
): Promise<Response | void> {
  const auth = c.req.header("Authorization");
  if (!auth || auth !== `Bearer ${c.env.API_KEY}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
}
```

- [ ] **Step 3: Verify both compile**

Run: `deno check src/middleware/cors.ts && deno check src/middleware/auth.ts`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/middleware/cors.ts src/middleware/auth.ts
git commit -m "feat: add CORS and auth middleware"
```

---

### Task 8: Create events route (`src/routes/events.ts`)

**Files:**
- Create: `src/routes/events.ts`

- [ ] **Step 1: Create events route**

Extract from `main.ts:600-665`. Uses Hono route group. All handlers use `c.var.sql` and `c.var.offsetMinutes`. Uses `parseEventQueryFromUrl`, `queryEvents` from `lib/queries.ts` and `withRetry` from `lib/db.ts`.

```ts
import { Hono } from "hono";
import type { Env, Vars } from "../types.ts";
import { parseEventQueryFromUrl, queryEvents } from "../lib/queries.ts";
import { withRetry } from "../lib/db.ts";

const events = new Hono<{ Bindings: Env; Variables: Vars }>();

events.post("/", async (c) => {
  const sql = c.var.sql;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const { type, value } = body as Record<string, unknown>;

  if (!type || typeof type !== "string") {
    return c.json({ error: "Missing or invalid 'type'" }, 400);
  }
  if (!/^[a-z0-9]+(\.[a-z0-9]+)*$/.test(type)) {
    return c.json({ error: "Invalid 'type' format: use dot-separated lowercase alphanumeric (e.g. app.open)" }, 400);
  }

  const eventValue = (value != null) ? String(value) : null;
  const now = new Date().toISOString();

  try {
    await withRetry(() =>
      sql`INSERT INTO events (type, value, ts) VALUES (${type}, ${eventValue}, ${now})`
    );
    return c.json({ ok: true });
  } catch (e) {
    console.error("DB error:", e);
    return c.json({ error: "Database error" }, 500);
  }
});

events.get("/", async (c) => {
  const sql = c.var.sql;
  const offsetMinutes = c.var.offsetMinutes;
  const url = new URL(c.req.url);
  const parsed = parseEventQueryFromUrl(url);
  if ("error" in parsed) {
    return c.json(parsed, 400);
  }

  try {
    return c.json(await queryEvents(parsed, sql, offsetMinutes));
  } catch (e) {
    console.error("DB error:", e);
    return c.json({ error: "Database error" }, 500);
  }
});

events.delete("/", async (c) => {
  const sql = c.var.sql;
  const url = new URL(c.req.url);
  const daysParam = url.searchParams.get("days");
  if (!daysParam) {
    return c.json({ error: "Missing 'days' parameter" }, 400);
  }

  const days = Number(daysParam);
  if (isNaN(days) || !Number.isInteger(days) || days < 1) {
    return c.json({ error: "'days' must be an integer >= 1" }, 400);
  }

  const cutoff = new Date(Date.now() - days * 86400_000);

  try {
    const result = await withRetry(() =>
      sql`DELETE FROM events WHERE ts < ${cutoff.toISOString()}`
    );
    return c.json({ ok: true, deleted: (result as { count: number }).count });
  } catch (e) {
    console.error("DB error:", e);
    return c.json({ error: "Database error" }, 500);
  }
});

export { events };
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check src/routes/events.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/events.ts
git commit -m "feat: add events route with POST/GET/DELETE handlers"
```

---

### Task 9: Create MCP route (`src/routes/mcp.ts`)

**Files:**
- Create: `src/routes/mcp.ts`

- [ ] **Step 1: Create MCP route**

Thin route file that delegates to `handleMcpPost` from `lib/mcp-protocol.ts`.

```ts
import { Hono } from "hono";
import type { Env, Vars } from "../types.ts";
import { handleMcpPost } from "../lib/mcp-protocol.ts";

const mcp = new Hono<{ Bindings: Env; Variables: Vars }>();

mcp.post("/", handleMcpPost);

mcp.on(["GET", "DELETE"], "/", (c) => {
  c.header("Allow", "POST, OPTIONS");
  return c.body(null, 405);
});

export { mcp };
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check src/routes/mcp.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/mcp.ts
git commit -m "feat: add MCP route"
```

---

### Task 10: Create app factory (`src/app.ts`)

**Files:**
- Create: `src/app.ts`

- [ ] **Step 1: Create app factory**

Assembles everything: CORS middleware, error handlers, DB injection, routes.

```ts
import { Hono } from "hono";
import type { Env, Vars } from "./types.ts";
import { corsMiddleware } from "./middleware/cors.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { createSql } from "./lib/db.ts";
import { parseOffsetEnv } from "./lib/timezone.ts";
import { events } from "./routes/events.ts";
import { mcp } from "./routes/mcp.ts";
import type postgres from "postgres";

export type AppOptions = {
  postgresOptions?: Record<string, unknown>;
};

let sqlInstance: postgres.Sql | null = null;

export function createApp(options?: AppOptions) {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>();

  // CORS
  app.use("*", corsMiddleware);

  // Global error handler
  app.onError((err, c) => {
    console.error("Unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: "Not found" }, 404);
  });

  // DB + timezone injection
  app.use("*", async (c, next) => {
    if (!sqlInstance) {
      const databaseUrl = c.env.DATABASE_URL ?? "";
      sqlInstance = createSql(databaseUrl, options?.postgresOptions);
    }
    c.set("sql", sqlInstance);
    c.set("offsetMinutes", parseOffsetEnv(c.env.TZ_OFFSET));
    await next();
  });

  // Routes
  app.route("/events", (() => {
    const group = new Hono<{ Bindings: Env; Variables: Vars }>();
    group.use("*", authMiddleware);
    group.route("/", events);
    return group;
  })());

  app.route("/mcp", mcp);

  return app;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `deno check src/app.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat: add Hono app factory with middleware and routing"
```

---

### Task 11: Create entry files

**Files:**
- Create: `entry/deno.ts`
- Create: `entry/cloudflare.ts`
- Create: `entry/node.ts`

- [ ] **Step 1: Create Deno entry**

```ts
import { createApp } from "../src/app.ts";

const app = createApp();

Deno.serve(app.fetch);
```

- [ ] **Step 2: Create Cloudflare Workers entry**

```ts
import { createApp } from "../src/app.ts";
// @ts-ignore: cloudflare:sockets is only available in CF Workers runtime
import { connect } from "cloudflare:sockets";

const app = createApp({
  postgresOptions: {
    connect: ({ hostname, port }: { hostname: string; port: number }) =>
      connect({ hostname, port }),
  },
});

export default app;
```

Note: This file will only compile in the CF Workers environment. That's expected — it's not used during Deno development.

- [ ] **Step 3: Create Node.js entry**

```ts
import { serve } from "@hono/node-server";
import { createApp } from "../src/app.ts";

const app = createApp();

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 8000,
});
```

Note: This file requires `@hono/node-server` installed via npm. It will only compile in a Node environment.

- [ ] **Step 4: Verify Deno entry compiles**

Run: `deno check entry/deno.ts`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add entry/deno.ts entry/cloudflare.ts entry/node.ts
git commit -m "feat: add platform entry files (Deno, CF Workers, Node)"
```

---

### Task 12: Integration test and cleanup

**Files:**
- Modify: `main.ts` (rename to `main.ts.bak` or delete after verification)

- [ ] **Step 1: Start the server with new entry point**

Run: `DATABASE_URL=<your-db-url> API_KEY=<your-key> deno task dev`
Expected: Server starts without errors

- [ ] **Step 2: Run integration tests**

Run: `BASE=http://localhost:8000 KEY=<your-key> ./test.sh`
Expected: All tests pass (same as before refactor)

Note: Ensure `TZ_OFFSET` is NOT set in the environment, or the `+08:00` timezone assertion in `test.sh` may fail. The default (unset) produces UTC+8 which matches the test expectation.

- [ ] **Step 3: Delete old main.ts**

Only after all tests pass. The old `main.ts` is fully replaced by the modular structure.

```bash
rm main.ts
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "refactor: complete Hono migration, remove old main.ts"
```
