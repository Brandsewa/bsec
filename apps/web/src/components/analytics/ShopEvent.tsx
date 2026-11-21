import { serializeShopEvent, type ShopEvent as ShopEventData } from "@bs/domain";
import { getCachedConsentConfig } from "@/server/cached-storefront.ts";

/**
 * A shop event for the store's optional GA4 and Meta Pixel (ADR-047). Server only, no client JavaScript: it renders an inert JSON
 * blob that `bsc.js` reads after the visitor has accepted. Rendered only when the store has set a tracking id, so other stores
 * ship nothing extra.
 */
export async function ShopEvent({ tenantId, build }: { tenantId: string; build: () => ShopEventData | null }) {
  const cfg = await getCachedConsentConfig(tenantId).catch(() => null);
  if (!cfg || (!cfg.ga4 && !cfg.pixel)) return null;
  const event = build();
  if (!event) return null;
  return <script type="application/json" data-bs-ev="" dangerouslySetInnerHTML={{ __html: serializeShopEvent(event) }} />;
}
