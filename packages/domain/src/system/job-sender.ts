import { PgBoss } from "pg-boss";

/**
 * A send-only pg-boss client for services that must enqueue background work but never process it (the web app).
 * Connects on first use, does not migrate, schedule or supervise, and keeps a tiny pool. The worker owns processing.
 * Only the media library uses it today (`Runtime._mediaJobs`), so the many `if (rt._jobs)` paths elsewhere keep
 * behaving exactly as before.
 */
export interface JobSender {
  send(queue: string, data: object): Promise<string | null>;
  close(): Promise<void>;
}

export function createLazyJobSender(databaseUrl: string, applicationName = "bsec-web-jobs"): JobSender {
  let boss: PgBoss | null = null;
  let starting: Promise<PgBoss> | null = null;

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
    send: async (queue, data) => (await get()).send(queue, data),
    close: async () => {
      if (boss) await boss.stop({ graceful: false });
      boss = null;
      starting = null;
    },
  };
}
