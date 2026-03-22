import { cors } from "hono/cors";

export const corsMiddleware = cors({
  origin: "*",
  allowHeaders: ["Authorization", "Content-Type", "MCP-Protocol-Version"],
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
});
