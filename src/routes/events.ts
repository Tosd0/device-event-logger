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
