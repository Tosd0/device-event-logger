import type postgres from "postgres";
import type { EventQuery, EventRecord } from "../types.ts";
import { formatWithOffset } from "./timezone.ts";
import { withRetry } from "./db.ts";

export function parseEventQueryFromUrl(url: URL): EventQuery | { error: string } {
  const result = parseEventQuery({
    hours: url.searchParams.get("hours") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
    until: url.searchParams.get("until") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    value: url.searchParams.get("value") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  }, false);
  // When allowDefaultHours=false, parseEventQuery never returns string
  return result as EventQuery | { error: string };
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
  const values: (string | number)[] = [];
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
