import { createApp } from "../src/app.ts";

const app = createApp();

Deno.serve(app.fetch);
