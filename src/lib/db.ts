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
