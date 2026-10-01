import "server-only";
import { revalidateTag } from "next/cache";
import { warnIfEncryptionKeyMissing, createLogger, createRuntime, type Logger, type Runtime } from "@bs/domain";

/**
 * One runtime per server process, role app_rw (RLS applies). Cached on globalThis so dev HMR
 * does not open a new pool on every edit. Pool size per PLAN §14.
 */
const g = globalThis as unknown as { __bsWeb?: { rt: Runtime; log: Logger } };

export function server(): { rt: Runtime; log: Logger } {
  warnIfEncryptionKeyMissing();
  if (!g.__bsWeb) {
    const url = process.env.DATABASE_URL_RW;
    if (!url) throw new Error("Missing env DATABASE_URL_RW");
    g.__bsWeb = {
      rt: createRuntime({
        service: "web",
        databaseUrl: url,
        saasDatabaseUrl: process.env.DATABASE_URL_SAAS || undefined,
        poolMax: Number(process.env.DB_POOL_MAX ?? 10),
        revalidateTags: (tags) => {
          for (const t of tags) {
            try {
              // eslint-disable-next-line bs/tenant-cache-tag -- tag strings are pre-verified tenant-prefixed via computeInvalidationTags
              revalidateTag(t, "max");
            } catch (err) {
              // revalidateTag() only works inside a Server Action/Route Handler request scope.
              // Domain mutations can legitimately run outside one (e.g. a worker job) - log so a
              // real misconfiguration (calling this from a route handler and still failing) is
              // visible, instead of a bare silent catch.
              g.__bsWeb?.log.warn({ err, tag: t }, "revalidateTag() failed outside request scope");
            }
          }
        },
      }),
      log: createLogger("web"),
    };
  }
  return g.__bsWeb;
}
