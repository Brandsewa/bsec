import * as Sentry from "@sentry/node";
import { serve } from "@hono/node-server";
import { warnIfEncryptionKeyMissing, createLogger, createRuntime, endDuePromotions, runBillingDunningSweep, runDueTenantDeletions } from "@bs/domain";
import { createApp } from "./app.ts";

warnIfEncryptionKeyMissing();

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.APP_ENV, release: process.env.APP_VERSION });
}

const url = process.env.DATABASE_URL_PLATFORM;
if (!url) throw new Error("Missing env DATABASE_URL_PLATFORM");

const log = createLogger("platform");
// The deletion sweep holds one connection (its advisory lock) while the workflow uses others, so keep the pool >= 4.
const rt = createRuntime({ service: "platform", databaseUrl: url, poolMax: Math.max(4, Number(process.env.DB_POOL_MAX ?? 5)) });
const port = Number(process.env.PORT ?? 4000);

const server = serve({ fetch: createApp(rt, log).fetch, port, hostname: "0.0.0.0" }, (info) => {
  log.info({ port: info.port }, "platform api listening");
});

// Tenant deletions (PLAN §6.4) are a durable workflow stored in tenant_deletions. This timer picks up every deletion
// whose grace period is over (and resumes interrupted ones). An advisory lock lets several instances take turns.
const sweepEveryMs = Number(process.env.DELETION_SWEEP_INTERVAL_MS ?? 60_000);
let sweeping = false;
const sweep = async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    const res = await runDueTenantDeletions(rt, {
      onError: (deletionId, err) => log.error({ err, deletionId }, "tenant deletion step failed; will retry"),
    });
    if (res.completed > 0 || res.failed > 0) log.info(res, "tenant deletion sweep");
  } catch (err) {
    log.error({ err }, "tenant deletion sweep failed");
  } finally {
    sweeping = false;
  }
};
// Promotions (ADR-035): a free period that ends without the store paying suspends it until it chooses a plan.
const promoSweep = async () => {
  try {
    const res = await endDuePromotions(rt);
    if (res.ended > 0) log.info(res, "promotion sweep");
  } catch (err) {
    log.error({ err }, "promotion sweep failed");
  }
};
const promoTimer = setInterval(() => void promoSweep(), Number(process.env.PROMOTION_SWEEP_INTERVAL_MS ?? 3_600_000));
promoTimer.unref();
setTimeout(() => void promoSweep(), 20_000).unref();

// Paid subscriptions that fail to charge: failure notice, reminder, then limit after the grace period (billing B5).
const dunningSweep = async () => {
  try {
    const res = await runBillingDunningSweep(rt);
    if (res.notified > 0 || res.reminded > 0 || res.limited > 0) log.info(res, "billing dunning sweep");
  } catch (err) {
    log.error({ err }, "billing dunning sweep failed");
  }
};
const dunningTimer = setInterval(() => void dunningSweep(), Number(process.env.DUNNING_SWEEP_INTERVAL_MS ?? 3_600_000));
dunningTimer.unref();
setTimeout(() => void dunningSweep(), 25_000).unref();

const sweepTimer = setInterval(() => void sweep(), sweepEveryMs);
sweepTimer.unref();
setTimeout(() => void sweep(), 15_000).unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info({ signal }, "shutting down");
    clearInterval(sweepTimer);
    server.close(() => void rt.close().then(() => process.exit(0)));
  });
}
