import * as Sentry from "@sentry/node";
import { createServer } from "node:http";
import { warnIfEncryptionKeyMissing, createLogger, createRuntime, checkHealth } from "@bs/domain";
import { startJobs } from "@bs/domain/jobs";

warnIfEncryptionKeyMissing();

/**
 * pg-boss consumers (PLAN §3, §11). Runs as app_rw; pg-boss schema and queues are created by
 * the migrate step, so this process starts with migrate:false. Side effects only happen here.
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.APP_ENV, release: process.env.APP_VERSION });
}

const url = process.env.DATABASE_URL_RW;
if (!url) throw new Error("Missing env DATABASE_URL_RW");

const log = createLogger("worker");
const saasUrl = process.env.DATABASE_URL_SAAS || undefined;
if (!saasUrl) log.warn("DATABASE_URL_SAAS not set: trial expiry sweep is disabled");
const rt = createRuntime({ service: "worker", databaseUrl: url, saasDatabaseUrl: saasUrl, poolMax: 2 });
const jobs = await startJobs({
  databaseUrl: url,
  log,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  db: rt._db.db,
  saasDb: rt._saasDb?.db,
});

// Tiny health endpoint for Docker/Coolify.
const port = Number(process.env.PORT ?? 4100);
const health = createServer((req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404).end();
    return;
  }
  void checkHealth(rt).then((h) => {
    const ok = h.db.ok && jobs.isRunning();
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ ...h, jobs: jobs.isRunning() }));
  });
}).listen(port, "0.0.0.0", () => log.info({ port }, "worker health listening"));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info({ signal }, "shutting down");
    health.close();
    void jobs
      .stop()
      .then(() => rt.close())
      .then(() => process.exit(0));
  });
}
