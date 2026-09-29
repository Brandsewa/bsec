import { createDb, ping, type DbHandle } from "@bs/db";
import { isEncryptionKeyConfigured } from "@bs/payments";
import type { Jobs } from "./jobs.ts";

export type CacheInvalidator = (tags: string[]) => Promise<void> | void;

/**
 * Apps never import @bs/db (lint-enforced). They create an opaque runtime here and pass it
 * to domain services. One set of credentials per process (PLAN §14).
 */
export interface Runtime {
  readonly service: "web" | "platform" | "worker";
  /** @internal used by domain services only */
  readonly _db: DbHandle;
  readonly _jobs?: Jobs | undefined;
  readonly revalidateTags?: CacheInvalidator | undefined;
  close(): Promise<void>;
}

export function createRuntime(opts: {
  service: Runtime["service"];
  databaseUrl: string;
  poolMax: number;
  revalidateTags?: CacheInvalidator | undefined;
  jobs?: Jobs | undefined;
}): Runtime {
  const handle = createDb(opts.databaseUrl, { max: opts.poolMax, applicationName: `bsec-${opts.service}` });
  return {
    service: opts.service,
    _db: handle,
    _jobs: opts.jobs,
    revalidateTags: opts.revalidateTags,
    close: () => handle.close(),
  };
}

export async function checkHealth(rt: Runtime) {
  const encryptionKeyConfigured = isEncryptionKeyConfigured();
  try {
    const db = await ping(rt._db.db);
    return {
      status: "ok" as const,
      service: rt.service,
      version: process.env.APP_VERSION ?? "dev",
      db: { ok: true, role: db.role },
      encryptionKeyConfigured,
    };
  } catch {
    return {
      status: "ok" as const,
      service: rt.service,
      version: process.env.APP_VERSION ?? "dev",
      db: { ok: false, role: "unreachable" },
      encryptionKeyConfigured,
    };
  }
}
