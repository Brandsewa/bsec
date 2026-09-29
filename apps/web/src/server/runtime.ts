import "server-only";
import { revalidateTag } from "next/cache";
import { createLogger, createRuntime, type Logger, type Runtime } from "@bs/domain";
import { invalidateStorefrontCache } from "./cached-storefront.ts";

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
      rt: createRuntime({
        service: "web",
        databaseUrl: url,
        poolMax: Number(process.env.DB_POOL_MAX ?? 10),
        revalidateTags: (tags) => {
          invalidateStorefrontCache(tags);
          for (const t of tags) {
            try {
              // eslint-disable-next-line bs/tenant-cache-tag -- tag strings are pre-verified tenant-prefixed via computeInvalidationTags
              revalidateTag(t, "max");
            } catch {
              // Ignore if outside Next.js request context
            }
          }
        },
      }),
      log: createLogger("web"),
    };
  }
  return g.__bsWeb;
}
