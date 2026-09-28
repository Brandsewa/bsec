import "server-only";
import { createLogger, createRuntime, type Logger, type Runtime } from "@bs/domain";

/**
 * One runtime per server process, role app_rw (RLS applies). Cached on globalThis so dev HMR
 * does not open a new pool on every edit. Pool size per PLAN §14.
 */
const g = globalThis as unknown as { __bsWeb?: { rt: Runtime; log: Logger } };

export function server(): { rt: Runtime; log: Logger } {
  if (!g.__bsWeb) {
    const url = process.env.DATABASE_URL_RW;
    if (!url) throw new Error("Missing env DATABASE_URL_RW");
    g.__bsWeb = {
      rt: createRuntime({ service: "web", databaseUrl: url, poolMax: Number(process.env.DB_POOL_MAX ?? 10) }),
      log: createLogger("web"),
    };
  }
  return g.__bsWeb;
}
