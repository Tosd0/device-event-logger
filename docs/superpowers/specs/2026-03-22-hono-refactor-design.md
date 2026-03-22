# Device Event Logger — Hono Refactor Design Spec

## Goal

Refactor the monolithic `main.ts` (raw `Deno.serve`) into a modular Hono application that runs on Cloudflare Workers, Deno, Supabase Edge Functions, and Railway (Node.js) without code changes — only the entry file differs per platform.

## Project Structure

```
src/
  app.ts                 ← Hono app factory, mounts routes and middleware
  routes/events.ts       ← /events (POST/GET/DELETE)
  routes/mcp.ts          ← /mcp (MCP JSON-RPC)
  middleware/cors.ts     ← CORS middleware config
  middleware/auth.ts     ← Bearer token auth middleware
  lib/db.ts              ← postgres connection init + withRetry + sleep
  lib/queries.ts         ← queryEvents, parseEventQuery*, buildEventSummaryText
  lib/mcp-protocol.ts    ← JSON-RPC helpers, tool definitions, request dispatch
  lib/timezone.ts        ← UTC+offset formatting with dynamic suffix generation
  types.ts               ← Shared type definitions (Env, EventRecord, EventQuery, etc.)
entry/
  deno.ts                ← Deno.serve(app.fetch)
  cloudflare.ts          ← export default app (+ cloudflare:sockets connect)
  node.ts                ← @hono/node-server, listens on PORT env var
deno.json
schema.sql               ← unchanged
init-db.sh               ← unchanged
test.sh                   ← unchanged
```

## Environment & Bindings

Hono typed bindings via `Hono<{ Bindings: Env; Variables: Vars }>`:

```ts
type Env = {
  API_KEY: string
  DATABASE_URL: string
  TZ_OFFSET?: string  // hours offset from UTC, default "8", range -12 to +14
}

type Vars = {
  sql: postgres.Sql       // injected by DB middleware
  offsetMinutes: number   // parsed from TZ_OFFSET env var
}
```

- `TZ_OFFSET` parsed as float to support half-hour offsets (e.g. `5.5` for India).
- Invalid values fall back to `8`.

## Module Responsibilities

### `src/app.ts`

Creates and exports the Hono app via `createApp(options?)` factory.

**`createApp` API:**
```ts
type AppOptions = {
  postgresOptions?: postgres.Options  // platform-specific postgres config (e.g. CF Workers connect)
}
function createApp(options?: AppOptions): Hono
```

Entry files pass platform-specific postgres options (e.g. CF Workers passes `{ connect }`) which are forwarded to `createSql()` in `lib/db.ts`.

Mounts:
1. CORS middleware (all routes)
2. Global error handler via `app.onError()` — returns `{ error: "Internal server error" }` with status 500
3. 404 handler via `app.notFound()` — returns `{ error: "Not found" }` with status 404
4. DB injection middleware (all routes) — creates/reuses postgres connection via `createSql()`, sets `c.var.sql`
5. `/events` route group with auth middleware
6. `/mcp` route group without auth

### `src/routes/events.ts`

Hono route group handling:
- `POST /events` — validate type format (regex `^[a-z0-9]+(\.[a-z0-9]+)*$`), insert event using tagged template SQL (parameterized, safe)
- `GET /events` — parse query params via `parseEventQueryFromUrl()`, query events via `queryEvents()`, return JSON with `c.json()`
- `DELETE /events` — validate `days` param, delete old events using tagged template SQL

All handlers access DB via `c.var.sql`. Responses use Hono's `c.json()` — CORS headers are injected automatically by the cors middleware.

### `src/routes/mcp.ts`

Hono route group handling:
- `POST /mcp` — delegates to `handleMcpPost()` from `lib/mcp-protocol.ts`
- `GET /mcp`, `DELETE /mcp` → 405 with `Allow: POST, OPTIONS` header
- Other methods → 405

The `handleMcpPost` handler (in `lib/mcp-protocol.ts`) contains full JSON-RPC protocol handling:
- **Single request**: validates protocol version header, parses JSON body, dispatches to `handleMcpRequest()`
- **Batch requests**: processes array of JSON-RPC messages, filters out notifications and response messages, returns array of results
- **Notifications** (`isJsonRpcNotification`): returns 202 with no body
- **Response messages** (`isJsonRpcResponse`): returns 202 with no body
- **Empty batch**: returns JSON-RPC error (-32600)
- **`MCP-Protocol-Version` response header**: set via `c.header()` before returning `c.json()`

### `src/middleware/cors.ts`

Uses Hono's built-in `cors()` middleware:

```ts
cors({
  origin: '*',
  allowHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
})
```

Hono's cors middleware automatically handles `OPTIONS` preflight requests, replacing the manual `OPTIONS` handling in the original code.

### `src/middleware/auth.ts`

Custom middleware that checks `Authorization: Bearer <API_KEY>`:

```ts
async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth || auth !== `Bearer ${c.env.API_KEY}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}
```

### `src/lib/db.ts`

Exports:
- `sleep(ms)` — simple promise-based delay
- `withRetry<T>(fn, retries?, delayMs?)` — existing retry logic for cold-start handling, uses `sleep` internally
- `createSql(databaseUrl: string, options?: postgres.Options)` — wraps `postgres()` with `max: 1` and any platform-specific options (e.g. CF Workers `connect` function)

Connection is created once per app initialization and reused across requests.

### `src/lib/queries.ts`

Shared query logic used by both events routes and MCP tool handlers:

- `parseEventQuery(input, allowDefaultHours)` — core parsing logic
- `parseEventQueryFromUrl(url)` — parses URL search params into `EventQuery`, returns `Response` on error
- `parseEventQueryFromToolArgs(args)` — parses MCP tool args into `EventQuery`, returns error string on error
- `queryEvents(query, sql, offsetMinutes)` — builds parameterized SQL using `sql.unsafe()` for dynamic WHERE clauses, returns `{ events, total }`
- `buildEventSummaryText(events, total)` — formats events into human-readable text for MCP tool responses

Both `sql.unsafe()` (for dynamic query building with parameterized values) and tagged template literals (for static INSERT/DELETE) are used — this matches the original code's patterns. Tagged templates provide automatic parameterization; `sql.unsafe()` is used where dynamic SQL construction is needed but still receives parameterized values (not string interpolation).

### `src/lib/mcp-protocol.ts`

Contains all MCP protocol constants and logic, extracted from current `main.ts`:
- `MCP_SERVER_INFO`, `QUERY_EVENTS_TOOL`, `LIST_EVENT_TYPES_TOOL` — tool definition constants
- `SUPPORTED_MCP_PROTOCOL_VERSIONS`, `DEFAULT_MCP_PROTOCOL_VERSION`
- JSON-RPC helpers: `jsonRpcError()`, `jsonRpcResult()`, `isJsonRpcRequest()`, `isJsonRpcNotification()`, `isJsonRpcResponse()`
- `handleMcpRequest(message, sql, offsetMinutes)` — main dispatch, takes `sql` and timezone offset as parameters
- `handleMcpPost(c)` — Hono-aware handler that reads body, validates protocol version header, handles batch/single dispatch, sets `MCP-Protocol-Version` response header via `c.header()`, returns via `c.json()`
- `callQueryEventsTool(args, sql, offsetMinutes)` — calls `queryEvents` + `buildEventSummaryText` from `lib/queries.ts`
- `callListEventTypesTool(sql)` — queries distinct event types

### `src/lib/timezone.ts`

Exports:
- `parseOffsetEnv(raw?: string): number` — parses `TZ_OFFSET` env var string to offset in minutes, defaults to `480` (UTC+8), clamps to range -720..+840 (-12h..+14h)
- `formatWithOffset(input: unknown, offsetMinutes: number): string | null` — same logic as current `formatUtcPlus8`, parameterized by offset. Generates dynamic timezone suffix:

```ts
// Suffix generation from offsetMinutes:
const sign = offsetMinutes >= 0 ? '+' : '-'
const abs = Math.abs(offsetMinutes)
const hh = String(Math.floor(abs / 60)).padStart(2, '0')
const mm = String(abs % 60).padStart(2, '0')
const suffix = `${sign}${hh}:${mm}`
// Examples: 480 → "+08:00", -300 → "-05:00", 330 → "+05:30"
```

### `src/types.ts`

Shared types: `Env`, `Vars`, `EventRecord`, `EventQuery`, `JsonRpcId`, `JsonRpcMessage`.

## Response Helpers

The original `json()` and `errorResponse()` helpers are **dropped**. Replaced by:
- `c.json(data, status)` — Hono's built-in JSON response (CORS headers injected by middleware)
- `c.header(name, value)` — for extra headers like `MCP-Protocol-Version` before calling `c.json()`

## Entry Files

### `entry/deno.ts`

```ts
import { createApp } from '../src/app.ts'
const app = createApp()
Deno.serve(app.fetch)
```

### `entry/cloudflare.ts`

```ts
import { createApp } from '../src/app.ts'
import { connect } from 'cloudflare:sockets'

const app = createApp({
  postgresOptions: { connect: ({ hostname, port }) => connect({ hostname, port }) }
})
export default app
```

### `entry/node.ts`

```ts
import { serve } from '@hono/node-server'
import { createApp } from '../src/app.ts'

const app = createApp()
serve({ fetch: app.fetch, port: Number(process.env.PORT) || 8000 })
```

## Database Connection Strategy

- `postgresjs` is used across all platforms
- Connection config differs only for CF Workers (custom `connect` function via `cloudflare:sockets`)
- `createApp()` forwards `postgresOptions` to `createSql()` for platform-specific connection setup
- Connection pool `max: 1` retained (suitable for serverless)

## What Does NOT Change

- All business logic (query building, event validation, MCP protocol handling) stays identical
- Database schema (`schema.sql`) unchanged
- `init-db.sh` and `test.sh` unchanged
- API behavior and response format fully preserved
- CORS headers identical
- OPTIONS preflight behavior identical (Hono cors middleware handles automatically)

## Package Management

`deno.json`:

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

Node entry additionally needs `@hono/node-server` (installed via npm/pnpm for Railway deploys).

## Migration Risk

Low. This is a structural refactor with no behavioral changes:
- All existing tests (`test.sh`) should pass without modification
- MCP protocol compliance unchanged (batch, notifications, version negotiation all preserved)
- Auth logic unchanged
