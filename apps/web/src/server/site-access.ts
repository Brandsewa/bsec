import { evaluateStorefrontAccess, getPlatformSiteId } from "@bs/domain";
import { isPlatformMarketingHost } from "@/server/hosts.ts";
import { server } from "@/server/runtime.ts";

/**
 * Which tenant a blog request belongs to. A store host goes through the store gate; the marketing host reads the website
 * record directly, which has no domain row so no other store route starts answering on bcom.si (ADR-042).
 */
export async function blogAccess(host: string, headers: Headers): Promise<{ tenantId: string | undefined; noindex: boolean | undefined }> {
  const { rt } = server();
  if (isPlatformMarketingHost(host)) return { tenantId: (await getPlatformSiteId(rt._db.db)) ?? undefined, noindex: false };
  const access = await evaluateStorefrontAccess(rt, host, { headers });
  return { tenantId: access.tenantId, noindex: access.noindex };
}
