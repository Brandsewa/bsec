import { PgBoss } from "pg-boss";
import type { Jobs } from "../jobs.ts";

/**
 * A send-only pg-boss client for services that must enqueue background work but never process it (the web app).
 * Connects on first use, does not migrate, schedule or supervise, and keeps a tiny pool. The worker owns processing.
 *
 * It is the web service's `Runtime._jobs`, so every `if (rt._jobs)` in the domain code (order confirmation, finance
 * posting, customer metrics, webhooks, fulfilment and refund notifications, large imports) now actually enqueues.
 *
 * Two deliberate choices:
 * - Best effort. A queue problem must never fail a checkout or an admin action: the error is logged and the
 *   business change stands (the worker's reconcile sweeps cover finance and media).
 * - Jobs start `startAfterSeconds` (default 2) after they are sent. Domain code sends them inside its transaction
 *   but on a different connection, so without a short delay the worker could look for a row that is not committed
 *   yet. Consumers also retry when a row is not visible yet.
 */
export interface JobSender extends Jobs {
  close(): Promise<void>;
}

export function createLazyJobSender(
  databaseUrl: string,
  options: { applicationName?: string; startAfterSeconds?: number; log?: (message: string, err: unknown) => void } = {},
): JobSender {
  const applicationName = options.applicationName ?? "bsec-web-jobs";
  const startAfter = options.startAfterSeconds ?? 2;
  const log = options.log ?? ((message: string, err: unknown) => console.warn(message, err));
  let boss: PgBoss | null = null;
  let starting: Promise<PgBoss> | null = null;
  let closed = false;

  const get = async (): Promise<PgBoss> => {
    if (boss) return boss;
    starting ??= (async () => {
      const instance = new PgBoss({
        connectionString: databaseUrl,
        max: 2,
        migrate: false,
        schedule: false,
        supervise: false,
        application_name: applicationName,
      });
      // A failed background connection must not crash the process: callers see the error from send()
      instance.on("error", () => undefined);
      await instance.start();
      boss = instance;
      return instance;
    })().catch((err: unknown) => {
      starting = null;
      throw err;
    });
    return starting;
  };

  return {
    isRunning: () => !closed,
    send: async (queue, data) => {
      try {
        return await (await get()).send(queue, data, { startAfter });
      } catch (err) {
        log(`[jobs] could not enqueue ${queue}:`, err);
        return null;
      }
    },
    stop: async () => {
      closed = true;
      if (boss) await boss.stop({ graceful: false });
      boss = null;
      starting = null;
    },
    close: async () => {
      closed = true;
      if (boss) await boss.stop({ graceful: false });
      boss = null;
      starting = null;
    },
  };
}
