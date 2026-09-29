import * as Sentry from "@sentry/node";
import { serve } from "@hono/node-server";
import { assertProductionEncryptionKeySet, createLogger, createRuntime } from "@bs/domain";
import { createApp } from "./app.ts";

assertProductionEncryptionKeySet();

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.APP_ENV, release: process.env.APP_VERSION });
}

const url = process.env.DATABASE_URL_PLATFORM;
if (!url) throw new Error("Missing env DATABASE_URL_PLATFORM");

const log = createLogger("platform");
const rt = createRuntime({ service: "platform", databaseUrl: url, poolMax: Number(process.env.DB_POOL_MAX ?? 3) });
const port = Number(process.env.PORT ?? 4000);

const server = serve({ fetch: createApp(rt, log).fetch, port, hostname: "0.0.0.0" }, (info) => {
  log.info({ port: info.port }, "platform api listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info({ signal }, "shutting down");
    server.close(() => void rt.close().then(() => process.exit(0)));
  });
}
