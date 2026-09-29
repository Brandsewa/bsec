import { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { QUEUE_NAMES } from "@bs/db";
import { createDb, type Db, type DbHandle } from "@bs/db";
import { expireOldReservations } from "./catalog/inventory-reservations.ts";

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

  // Proof of life on boot: enqueue one ping so logs show the round trip.
  await boss.send("system.ping", { at: new Date().toISOString() });
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
