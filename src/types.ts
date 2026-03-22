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
