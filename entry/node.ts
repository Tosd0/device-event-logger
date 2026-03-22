import { serve } from "@hono/node-server";
import { createApp } from "../src/app.ts";

const app = createApp();

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 8000,
});
