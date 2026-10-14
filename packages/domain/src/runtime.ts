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
  /** @internal second connection as app_saas for self-service paths (web/worker only); see saasDb(). */
  readonly _saasDb?: DbHandle | undefined;
  readonly _jobs?: Jobs | undefined;
  readonly revalidateTags?: CacheInvalidator | undefined;
  close(): Promise<void>;
}

export function createRuntime(opts: {
  service: Runtime["service"];
  databaseUrl: string;
  /** app_saas connection string. Optional: without it the self-service paths report "not configured". */
  saasDatabaseUrl?: string | undefined;
  poolMax: number;
  revalidateTags?: CacheInvalidator | undefined;
  jobs?: Jobs | undefined;
}): Runtime {
  const handle = createDb(opts.databaseUrl, { max: opts.poolMax, applicationName: `bsec-${opts.service}` });
  const saasHandle = opts.saasDatabaseUrl
    ? createDb(opts.saasDatabaseUrl, { max: Math.max(2, Math.floor(opts.poolMax / 2)), applicationName: `bsec-${opts.service}-saas` })
    : undefined;
  return {
    service: opts.service,
    _db: handle,
    _saasDb: saasHandle,
    _jobs: opts.jobs,
    revalidateTags: opts.revalidateTags,
    close: async () => {
      await Promise.all([handle.close(), saasHandle?.close()]);
    },
  };
}

export class SaasNotConfiguredError extends Error {
  constructor() {
    super("Self-service is not configured on this deployment (DATABASE_URL_SAAS / APP_SAAS_PASSWORD missing)");
    this.name = "SaasNotConfiguredError";
  }
}

/**
 * The database handle for self-service paths (signup, billing, trial sweep, owner invites).
 * The platform service already has the platform role; web and worker use their separate app_saas connection.
 */
export function saasDb(rt: Runtime): DbHandle["db"] {
  if (rt._saasDb) return rt._saasDb.db;
  if (rt.service === "platform") return rt._db.db;
  throw new SaasNotConfiguredError();
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
