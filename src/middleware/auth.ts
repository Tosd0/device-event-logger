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
