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
