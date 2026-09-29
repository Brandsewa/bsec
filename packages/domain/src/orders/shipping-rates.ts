export type ShippingMethod = "standard" | "express";

export interface ShippingRateCalculation {
  method: ShippingMethod;
  title: string;
  amount: number; // in paise
  isFree: boolean;
  estimatedDays: string;
  description: string;
}

/**
 * Canonical shipping rate calculation function across cart and checkout (PLAN §5.4, §7 / M7 fix).
 * Resolves the shipping calculation mismatch between cart and checkout:
 * - Standard: ₹50 (5000 paise), free if subtotal >= ₹999 (99900 paise)
 * - Express: ₹120 (12000 paise)
 */
export function calculateShippingRate(
  subtotalPaise: number,
  method: ShippingMethod = "standard",
): ShippingRateCalculation {
  if (method === "express") {
    return {
      method: "express",
      title: "Express Shipping",
      description: "Expedited air delivery within 2-3 business days",
      amount: 12000,
      isFree: false,
      estimatedDays: "2-3 business days",
    };
  }

  const isFree = subtotalPaise >= 99900;
  return {
    method: "standard",
    title: "Standard Shipping",
    description: isFree
      ? "Free standard delivery (orders over ₹999)"
      : "Standard delivery within 4-7 business days",
    amount: isFree ? 0 : 5000,
    isFree,
    estimatedDays: "4-7 business days",
  };
}
