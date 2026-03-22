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
