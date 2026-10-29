/**
 * Order settings configuration parser (PLAN §4.2, §4.3 / Settings Phase 4).
 * Reads and writes `store_settings.order_settings` JSONB.
 */

export interface OrderProcessingConfig {
  v: 1;
  stockHoldMinutes: number; // 5..120, default 30
  minimumOrderPaise: number; // 0..10_000_00, default 0
}

export const DEFAULT_ORDER_PROCESSING_CONFIG: OrderProcessingConfig = {
  v: 1,
  stockHoldMinutes: 30,
  minimumOrderPaise: 0,
};

export function parseOrderProcessingConfig(raw: unknown): OrderProcessingConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_ORDER_PROCESSING_CONFIG };
  }

  const c = raw as Record<string, unknown>;

  const stockHoldMinutes =
    typeof c.stockHoldMinutes === "number" && Number.isFinite(c.stockHoldMinutes)
      ? Math.max(5, Math.min(120, Math.round(c.stockHoldMinutes)))
      : DEFAULT_ORDER_PROCESSING_CONFIG.stockHoldMinutes;

  const minimumOrderPaise =
    typeof c.minimumOrderPaise === "number" && Number.isFinite(c.minimumOrderPaise) && c.minimumOrderPaise >= 0
      ? Math.min(10_000_00, Math.round(c.minimumOrderPaise))
      : DEFAULT_ORDER_PROCESSING_CONFIG.minimumOrderPaise;

  return {
    v: 1,
    stockHoldMinutes,
    minimumOrderPaise,
  };
}

/** How the public /track page identifies a shopper's order. */
export type TrackingLookup = "either" | "email" | "phone";

export interface TrackingCarrier {
  name: string;
  /** Optional link pattern; `{awb}` is replaced by the tracking number. Must be http(s). */
  urlTemplate: string;
}

/** Customer-facing tracking options, stored under `order_settings.tracking` (ORDER-TRACKING-PLAN phase C). */
export interface TrackingConfig {
  enabled: boolean;
  lookup: TrackingLookup;
  showTimeline: boolean;
  showCarrierDetails: boolean;
  /** Days after dispatch shown as "Estimated delivery"; null hides it. */
  estimatedDeliveryDays: number | null;
  /** Plain text shown above the tracker (no HTML: ADR-010). */
  message: string;
  notifyByDefault: boolean;
  carriers: TrackingCarrier[];
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  enabled: true,
  lookup: "either",
  showTimeline: true,
  showCarrierDetails: true,
  estimatedDeliveryDays: null,
  message: "",
  notifyByDefault: false,
  carriers: [],
};

const isHttpUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);

export function parseTrackingConfig(raw: unknown): TrackingConfig {
  const d = DEFAULT_TRACKING_CONFIG;
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const root = (typeof o === "object" && o ? (o as Record<string, unknown>)["tracking"] : null) as unknown;
  const c = root && typeof root === "object" && !Array.isArray(root) ? (root as Record<string, unknown>) : null;
  if (!c) return { ...d, carriers: [] };
  const bool = (k: string, fallback: boolean) => (typeof c[k] === "boolean" ? (c[k] as boolean) : fallback);
  const days = c["estimatedDeliveryDays"];
  const carriers = Array.isArray(c["carriers"])
    ? (c["carriers"] as unknown[]).flatMap((x): TrackingCarrier[] => {
        if (!x || typeof x !== "object") return [];
        const r = x as Record<string, unknown>;
        const name = typeof r["name"] === "string" ? r["name"].trim().slice(0, 40) : "";
        const tpl = typeof r["urlTemplate"] === "string" ? r["urlTemplate"].trim().slice(0, 300) : "";
        return name ? [{ name, urlTemplate: isHttpUrl(tpl) ? tpl : "" }] : [];
      }).slice(0, 20)
    : [];
  return {
    enabled: bool("enabled", d.enabled),
    lookup: c["lookup"] === "email" || c["lookup"] === "phone" ? c["lookup"] : "either",
    showTimeline: bool("showTimeline", d.showTimeline),
    showCarrierDetails: bool("showCarrierDetails", d.showCarrierDetails),
    estimatedDeliveryDays: typeof days === "number" && Number.isFinite(days) && days >= 1 ? Math.min(60, Math.round(days)) : null,
    message: typeof c["message"] === "string" ? c["message"].slice(0, 300) : "",
    notifyByDefault: bool("notifyByDefault", d.notifyByDefault),
    carriers,
  };
}

/** The tracking link for a carrier's template and a tracking number, or null when there is no usable template. */
export function carrierTrackingUrl(carriers: TrackingCarrier[], carrierName: string, awb: string): string | null {
  const tpl = carriers.find((c) => c.name.toLowerCase() === carrierName.trim().toLowerCase())?.urlTemplate;
  if (!tpl || !awb.trim()) return null;
  const url = tpl.replaceAll("{awb}", encodeURIComponent(awb.trim()));
  return isHttpUrl(url) ? url : null;
}
