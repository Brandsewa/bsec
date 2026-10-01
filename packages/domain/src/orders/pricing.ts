/**
 * The one place an order's money is worked out. The cart page, the checkout page and placeOrder all call it, so the
 * total a shopper sees is the total they are charged. All amounts are paise.
 */
export interface PricingDiscount {
  /** The kind of code: "free_shipping" waives the shipping charge, anything else reduces the goods total. */
  type: string;
  /** For goods discounts: the amount off. Ignored for free shipping. */
  discountAmount: number;
}

export interface OrderPricing {
  subtotal: number;
  /** Amount taken off the goods (percent / fixed codes). */
  discountTotal: number;
  /** Shipping actually charged (0 when a free-shipping code applies). */
  shippingTotal: number;
  /** Shipping that a free-shipping code waived. */
  shippingDiscount: number;
  codFee: number;
  grandTotal: number;
  /** What the code is worth to the shopper in total (goods discount plus waived shipping): what gets recorded as redeemed. */
  discountValue: number;
}

export function priceOrder(input: { subtotal: number; shipping: number; codFee: number; discount?: PricingDiscount | null | undefined }): OrderPricing {
  const subtotal = Math.max(0, Math.round(input.subtotal));
  const shipping = Math.max(0, Math.round(input.shipping));
  const codFee = Math.max(0, Math.round(input.codFee));
  const d = input.discount ?? null;

  const freeShipping = d?.type === "free_shipping";
  const discountTotal = d && !freeShipping ? Math.min(subtotal, Math.max(0, Math.round(d.discountAmount))) : 0;
  const shippingDiscount = freeShipping ? shipping : 0;
  const shippingTotal = shipping - shippingDiscount;

  return {
    subtotal,
    discountTotal,
    shippingTotal,
    shippingDiscount,
    codFee,
    grandTotal: subtotal - discountTotal + shippingTotal + codFee,
    discountValue: discountTotal + shippingDiscount,
  };
}

/** Splits a goods discount across order lines in proportion to their totals; the last line takes the rounding remainder. */
export function allocateDiscount(lineTotals: number[], discountTotal: number): number[] {
  const sum = lineTotals.reduce((a, b) => a + b, 0);
  if (discountTotal <= 0 || sum <= 0) return lineTotals.map(() => 0);
  let allocated = 0;
  return lineTotals.map((line, i) => {
    if (i === lineTotals.length - 1) return discountTotal - allocated;
    const share = Math.floor((line * discountTotal) / sum);
    allocated += share;
    return share;
  });
}
