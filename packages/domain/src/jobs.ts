import { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { QUEUE_NAMES } from "@bs/db";
import { createDb, type Db, type DbHandle } from "@bs/db";
import { expireOldReservations } from "./catalog/inventory-reservations.ts";
import { processWebhookInboxItem } from "./system/webhooks.ts";
import { cleanupExpiredIdempotencyKeys } from "./system/idempotency.ts";

/**
 * Job runtime (PLAN §11). Queues are created by the migrate step (as app_owner); workers run
 * as app_rw with migrate:false. Every consumer must be idempotent. From M1 domain services
 * enqueue inside their business transaction (transactional outbox).
 */
export interface Jobs {
  isRunning(): boolean;
  stop(): Promise<void>;
  send(queue: string, data: object): Promise<string | null>;
}

export async function startJobs(opts: {
  databaseUrl: string;
  log: Logger;
  concurrency: number;
  db?: Db | undefined;
}): Promise<Jobs> {
  const boss = new PgBoss({ connectionString: opts.databaseUrl, max: 3, migrate: false, application_name: "bsec-worker" });
  let running = false;
  boss.on("error", (err) => opts.log.error({ err }, "pg-boss error"));
  await boss.start();
  running = true;

  let localDbHandle: DbHandle | undefined;
  const db = opts.db ?? (() => {
    localDbHandle = createDb(opts.databaseUrl, { max: 2, applicationName: "bsec-worker-jobs" });
    return localDbHandle.db;
  })();

  await boss.work<{ at: string }>("system.ping", { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) opts.log.info({ job_id: job.id, at: job.data.at }, "system.ping");
  });

  // Handle inventory reservation expiration (PLAN §11.3)
  await boss.work<{ tenantId?: string }>(QUEUE_NAMES.RESERVATION_EXPIRY, { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) {
      try {
        const res = await expireOldReservations(db, job.data?.tenantId);
        opts.log.info({ job_id: job.id, expiredCount: res.expiredCount }, "reservation.expiry processed");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "reservation.expiry failed");
        throw err;
      }
    }
  });

  // Handle webhook background processing (PLAN §11.4)
  await boss.work<{ inboxId: string }>(QUEUE_NAMES.WEBHOOK_PROCESS, { localConcurrency: 2 }, async (batch) => {
    for (const job of batch) {
      try {
        const res = await processWebhookInboxItem(db, job.data.inboxId);
        opts.log.info({ job_id: job.id, inboxId: job.data.inboxId, success: res.success }, "webhook.process completed");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "webhook.process failed");
        throw err;
      }
    }
  });

  // Handle idempotency keys cleanup (PLAN §5.10)
  await boss.work<{ tenantId?: string }>(QUEUE_NAMES.IDEMPOTENCY_CLEANUP, { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) {
      try {
        const res = await cleanupExpiredIdempotencyKeys(db, job.data?.tenantId);
        opts.log.info({ job_id: job.id, deletedCount: res.deletedCount }, "idempotency.cleanup processed");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "idempotency.cleanup failed");
        throw err;
      }
    }
  });

  // Register recurring schedules and proof-of-life sweeps on boot (PLAN §5.10, §11.3)
  try {
    await boss.schedule(QUEUE_NAMES.RESERVATION_EXPIRY, "* * * * *", {});
    await boss.schedule(QUEUE_NAMES.IDEMPOTENCY_CLEANUP, "*/15 * * * *", {});
    opts.log.info("Registered recurring cron: reservation.expiry (* * * * *), idempotency.cleanup (*/15 * * * *)");
  } catch (err) {
    opts.log.warn({ err }, "Could not register recurring cron schedules with pg-boss");
  }

  // Proof of life on boot: enqueue one ping and trigger initial maintenance passes
  await boss.send("system.ping", { at: new Date().toISOString() });
  await boss.send(QUEUE_NAMES.RESERVATION_EXPIRY, {});
  await boss.send(QUEUE_NAMES.IDEMPOTENCY_CLEANUP, {});
  opts.log.info({ concurrency: opts.concurrency }, "worker started");

  return {
    isRunning: () => running,
    send: (queue, data) => boss.send(queue, data),
    stop: async () => {
      running = false;
      await boss.stop({ graceful: true, timeout: 20_000 });
      if (localDbHandle) {
        await localDbHandle.close();
      }
    },
  };
}
