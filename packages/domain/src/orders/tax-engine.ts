/**
 * Unified Tax Engine (PLAN §15 / Settings Rebuild Phase 6 / Slice 6A).
 *
 * Single authoritative GST calculator module used by:
 * - Storefront placeOrder (checkout.ts)
 * - Admin draft orders (admin/orders.ts createDraft & estimateDraft)
 * - GST Tax Invoices & Credit Notes (orders/invoices.ts generateInvoice)
 *
 * Rules:
 * - Pure functions with integer paise throughout.
 * - Tax-inclusive vs tax-exclusive calculation per line.
 * - Intra-state: CGST (50%) + SGST (50%). Odd paise allocated to SGST per existing engine parity.
 * - Inter-state: IGST (100%).
 * - Apportions order-level discount across lines with largest remainder so sum matches exactly.
 * - Shipping tax modes: "highest_line_rate" (conservative mixed supply) or "none".
 * - Tax collection toggle: if false, 0 GST lines / tax total = 0.
 * - Invoice totals are exact sums of lines (no recomputing with divergence).
 */

export interface TaxEngineLineInput {
  id?: string | undefined;
  orderItemId?: string | undefined;
  variantId?: string | undefined;
  sku?: string | null | undefined;
  productTitle?: string | undefined;
  hsn?: string | null | undefined;
  quantity: number;
  unitPrice: number; // in paise
  discountAmount?: number | undefined; // allocated discount in paise
  taxRateBps: number; // basis points (0, 250, 300, 500, 1200, 1800, 2800)
}

export interface TaxEngineInput {
  lines: TaxEngineLineInput[];
  orderDiscountTotal?: number | undefined; // order-level discount in paise if not yet allocated
  shippingTotal?: number | undefined; // in paise
  shippingTaxMode?: "highest_line_rate" | "none" | undefined;
  taxCollectionEnabled?: boolean | undefined;
  pricesIncludeTax: boolean;
  sellerState?: string | null | undefined;
  destinationState?: string | null | undefined;
}

export interface TaxEngineLineResult {
  id?: string | undefined;
  orderItemId?: string | undefined;
  variantId?: string | undefined;
  sku?: string | null | undefined;
  productTitle?: string | undefined;
  hsn?: string | null | undefined;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxableAmount: number; // in paise
  taxRateBps: number;
  isInterState: boolean;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  lineTotal: number; // taxableAmount + totalTax (equals grossTotal - discountAmount when inclusive)
}

export interface TaxEngineShippingResult {
  shippingTotal: number;
  shippingTaxable: number;
  taxRateBps: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
}

export interface TaxEngineResult {
  isInterState: boolean;
  originState: string;
  destinationState: string;
  lines: TaxEngineLineResult[];
  shipping: TaxEngineShippingResult;
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  grandTotal: number;
}

export function normalizeState(state?: string | null): string {
  if (!state) return "";
  return state.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Apportions an order-level discount across lines in proportion to their line gross totals,
 * using largest-remainder method so the sum of discounts equals discountTotal exactly.
 */
export function apportionDiscount(lineTotals: number[], discountTotal: number): number[] {
  if (!discountTotal || discountTotal <= 0 || lineTotals.length === 0) {
    return lineTotals.map(() => 0);
  }

  const sumTotals = lineTotals.reduce((a, b) => a + b, 0);
  if (sumTotals <= 0) {
    return lineTotals.map(() => 0);
  }

  const cappedDiscount = Math.min(discountTotal, sumTotals);

  const exacts = lineTotals.map((tot) => (tot * cappedDiscount) / sumTotals);
  const floors = exacts.map((e) => Math.floor(e));
  const remainder = cappedDiscount - floors.reduce((a, b) => a + b, 0);

  // Distribute remainder 1 paisa at a time by highest fractional part
  const fractions = exacts
    .map((e, idx) => ({ idx, frac: e - (floors[idx] ?? 0) }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < remainder; i++) {
    const item = fractions[i % fractions.length];
    if (item) {
      floors[item.idx] = (floors[item.idx] ?? 0) + 1;
    }
  }

  return floors;
}

/**
 * Calculates GST for lines, shipping, and totals.
 */
export function calculateTax(input: TaxEngineInput): TaxEngineResult {
  const originState = (input.sellerState ?? "").trim();
  const destinationState = (input.destinationState ?? "").trim();
  const isInterState = normalizeState(originState) !== normalizeState(destinationState);

  const taxCollectionEnabled = input.taxCollectionEnabled ?? true;
  const pricesIncludeTax = input.pricesIncludeTax;

  // 1. Apportion order-level discount if individual lines do not have discountAmount set
  const hasLineDiscounts = input.lines.some((l) => (l.discountAmount ?? 0) > 0);
  let allocatedDiscounts: number[] = [];
  if (!hasLineDiscounts && input.orderDiscountTotal && input.orderDiscountTotal > 0) {
    const grossTotals = input.lines.map((l) => l.unitPrice * l.quantity);
    allocatedDiscounts = apportionDiscount(grossTotals, input.orderDiscountTotal);
  } else {
    allocatedDiscounts = input.lines.map((l) => l.discountAmount ?? 0);
  }

  // 2. Calculate each line
  let totalSubtotal = 0;
  let totalDiscount = 0;
  let linesTaxable = 0;
  let linesCgst = 0;
  let linesSgst = 0;
  let linesIgst = 0;
  let maxLineTaxRateBps = 0;

  const lineResults: TaxEngineLineResult[] = input.lines.map((line, idx) => {
    const gross = line.unitPrice * line.quantity;
    const discount = Math.min(gross, Math.max(0, allocatedDiscounts[idx] ?? 0));
    const net = Math.max(0, gross - discount);

    totalSubtotal += gross;
    totalDiscount += discount;

    const rateBps = taxCollectionEnabled ? line.taxRateBps : 0;
    if (rateBps > maxLineTaxRateBps) {
      maxLineTaxRateBps = rateBps;
    }

    let taxableAmount: number;
    let totalTax: number;

    if (rateBps <= 0) {
      taxableAmount = net;
      totalTax = 0;
    } else if (pricesIncludeTax) {
      taxableAmount = Math.round((net * 10000) / (10000 + rateBps));
      totalTax = net - taxableAmount;
    } else {
      taxableAmount = net;
      totalTax = Math.round((taxableAmount * rateBps) / 10000);
    }

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (totalTax > 0) {
      if (isInterState) {
        igst = totalTax;
      } else {
        cgst = Math.floor(totalTax / 2);
        sgst = totalTax - cgst; // extra odd paisa goes to SGST to match existing engine
      }
    }

    linesTaxable += taxableAmount;
    linesCgst += cgst;
    linesSgst += sgst;
    linesIgst += igst;

    return {
      id: line.id,
      orderItemId: line.orderItemId,
      variantId: line.variantId,
      sku: line.sku,
      productTitle: line.productTitle,
      hsn: line.hsn,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: discount,
      taxableAmount,
      taxRateBps: line.taxRateBps,
      isInterState,
      cgst,
      sgst,
      igst,
      totalTax,
      lineTotal: taxableAmount + totalTax,
    };
  });

  // 3. Shipping tax calculation
  const shippingTotal = Math.max(0, input.shippingTotal ?? 0);
  const shippingTaxMode = input.shippingTaxMode ?? "highest_line_rate";

  let shippingRateBps = 0;
  if (taxCollectionEnabled && shippingTaxMode === "highest_line_rate" && shippingTotal > 0) {
    shippingRateBps = maxLineTaxRateBps;
  }

  let shippingTaxable = shippingTotal;
  let shippingTotalTax = 0;
  let shippingCgst = 0;
  let shippingSgst = 0;
  let shippingIgst = 0;

  if (shippingRateBps > 0 && shippingTotal > 0) {
    if (pricesIncludeTax) {
      shippingTaxable = Math.round((shippingTotal * 10000) / (10000 + shippingRateBps));
      shippingTotalTax = shippingTotal - shippingTaxable;
    } else {
      shippingTaxable = shippingTotal;
      shippingTotalTax = Math.round((shippingTaxable * shippingRateBps) / 10000);
    }

    if (isInterState) {
      shippingIgst = shippingTotalTax;
    } else {
      shippingCgst = Math.floor(shippingTotalTax / 2);
      shippingSgst = shippingTotalTax - shippingCgst;
    }
  }

  const grandCgst = linesCgst + shippingCgst;
  const grandSgst = linesSgst + shippingSgst;
  const grandIgst = linesIgst + shippingIgst;
  const grandTax = grandCgst + grandSgst + grandIgst;
  const grandTaxable = linesTaxable + shippingTaxable;
  const grandTotal = grandTaxable + grandTax;

  return {
    isInterState,
    originState,
    destinationState,
    lines: lineResults,
    shipping: {
      shippingTotal,
      shippingTaxable,
      taxRateBps: shippingRateBps,
      cgst: shippingCgst,
      sgst: shippingSgst,
      igst: shippingIgst,
      totalTax: shippingTotalTax,
    },
    subtotal: totalSubtotal,
    discountTotal: totalDiscount,
    taxableAmount: grandTaxable,
    cgst: grandCgst,
    sgst: grandSgst,
    igst: grandIgst,
    totalTax: grandTax,
    grandTotal,
  };
}
