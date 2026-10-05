import { eq, and } from "drizzle-orm";
import {
  invoices,
  orders,
  orderItems,
  storeSettings,
  withTenant,
  type Db,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { allocateSequenceNumber } from "./sequences.ts";
import { readStoreConfig } from "../admin/store-config.ts";

/**
 * Returns Indian Financial Year string (e.g. 2026-27).
 * Financial year begins on April 1 and ends on March 31.
 */
export function getIndianFinancialYear(date: Date = new Date()): string {
  const month = date.getMonth(); // 0 = Jan, 3 = April
  const year = date.getFullYear();
  if (month >= 3) {
    const nextYearShort = String((year + 1) % 100).padStart(2, "0");
    return `${year}-${nextYearShort}`;
  } else {
    const currentYearShort = String(year % 100).padStart(2, "0");
    return `${year - 1}-${currentYearShort}`;
  }
}

export interface TaxLineCalculation {
  orderItemId: string;
  variantId: string;
  sku?: string | null | undefined;
  productTitle: string;
  hsn?: string | null | undefined;
  quantity: number;
  unitPrice: number; // in paise
  discountAmount: number; // in paise
  taxableAmount: number; // in paise = (unitPrice * quantity) - discountAmount
  taxRateBps: number; // basis points, e.g. 1800 = 18%
  isInterState: boolean;
  cgst: number; // in paise
  sgst: number; // in paise
  igst: number; // in paise
  totalTax: number; // in paise
  lineTotal: number; // in paise = taxableAmount + totalTax
}

export interface InvoiceTotals {
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  shippingTaxable: number;
  shippingCgst: number;
  shippingSgst: number;
  shippingIgst: number;
  shippingTotal: number;
  grandTotal: number;
  isInterState: boolean;
}

import { isFeatureEnabled } from "../features.ts";
import { normalizeState } from "./tax-engine.ts";
import { resolveTaxClass } from "../admin/tax-settings.ts";

export interface GenerateInvoiceInput {
  orderId: string;
  type?: "invoice" | "credit_note" | undefined;
  sellerGstin?: string | undefined;
  sellerState?: string | undefined; // default store state
  buyerGstin?: string | undefined;
  placeOfSupplyState?: string | undefined;
  pricesIncludeTax?: boolean | undefined;
  returnId?: string | undefined;
  parentInvoiceId?: string | undefined;
  creditLines?: Array<{ orderItemId: string; quantity: number }> | undefined;
}

export interface GenerateInvoiceResult {
  invoiceId: string;
  number: string;
  fy: string;
  type: string;
  issuedAt: Date;
  totals: InvoiceTotals;
  lineItems: TaxLineCalculation[];
}

export { normalizeState } from "./tax-engine.ts";

/**
 * Calculates GST line item amounts according strictly to PLAN §15 V1 rules:
 * - Tax-inclusive vs tax-exclusive calculation.
 * - HSN and taxRateBps snapshotting.
 * - Intra-state (CGST + SGST: rate split 50/50) vs Inter-state (IGST: full rate).
 * - Discounts reduce taxable value before tax is applied.
 * - Rounding to nearest paise / integer.
 */
export function calculateGstLineItem(opts: {
  orderItemId: string;
  variantId: string;
  sku?: string | null | undefined;
  productTitle: string;
  hsn?: string | null | undefined;
  quantity: number;
  unitPrice: number; // in paise
  discountAmount?: number | undefined; // in paise
  taxRateBps: number;
  pricesIncludeTax: boolean;
  isInterState: boolean;
}): TaxLineCalculation {
  const {
    orderItemId,
    variantId,
    sku,
    productTitle,
    hsn,
    quantity,
    unitPrice,
    discountAmount = 0,
    taxRateBps,
    pricesIncludeTax,
    isInterState,
  } = opts;

  let taxableAmount: number;
  let totalTax: number;

  const grossTotal = unitPrice * quantity;
  const netAmount = Math.max(0, grossTotal - discountAmount);

  if (pricesIncludeTax && taxRateBps > 0) {
    // Taxable = Net / (1 + Rate)
    // with taxRateBps (e.g. 1800 bps = 0.18): Net * 10000 / (10000 + taxRateBps)
    taxableAmount = Math.round((netAmount * 10000) / (10000 + taxRateBps));
    totalTax = netAmount - taxableAmount;
  } else {
    taxableAmount = netAmount;
    totalTax = Math.round((taxableAmount * taxRateBps) / 10000);
  }

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (isInterState) {
    igst = totalTax;
  } else {
    // Split equally into CGST & SGST
    cgst = Math.floor(totalTax / 2);
    sgst = totalTax - cgst;
  }

  return {
    orderItemId,
    variantId,
    sku,
    productTitle,
    hsn,
    quantity,
    unitPrice,
    discountAmount,
    taxableAmount,
    taxRateBps,
    isInterState,
    cgst,
    sgst,
    igst,
    totalTax,
    lineTotal: taxableAmount + totalTax,
  };
}

/**
 * Generates and commits a GST Tax Invoice or Credit Note per PLAN §15 / §11.2.
 * Allocates sequence number gaplessly per financial year inside the transaction.
 */
export async function generateInvoice(
  rt: Runtime,
  ctx: TenantContext,
  input: GenerateInvoiceInput,
  tx?: Db,
): Promise<GenerateInvoiceResult> {
  const runner = async (db: Db): Promise<GenerateInvoiceResult> => {
    // 1. Fetch order and items
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.id, input.orderId)));

    if (!order) {
      throw new Error(`Order not found: ${input.orderId}`);
    }

    // Idempotency: if credit note for this return already exists, return it
    if (input.type === "credit_note" && input.returnId) {
      const [existingCn] = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, ctx.tenantId),
            eq(invoices.returnId, input.returnId),
            eq(invoices.type, "credit_note"),
          ),
        )
        .limit(1);

      if (existingCn) {
        return {
          invoiceId: existingCn.id,
          number: existingCn.number,
          fy: existingCn.fy,
          type: "credit_note",
          issuedAt: existingCn.issuedAt,
          totals: existingCn.totals as unknown as InvoiceTotals,
          lineItems: [],
        };
      }
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.tenantId, ctx.tenantId), eq(orderItems.orderId, input.orderId)));

    // 2. Check feature flag & resolve place of supply
    const gstV2Enabled = await isFeatureEnabled(db, ctx.tenantId, "settings.gst_v2");
    const storeCfg = await readStoreConfig(db);
    const [settingsRow] = await db
      .select({ address: storeSettings.address, checkout: storeSettings.checkout })
      .from(storeSettings)
      .limit(1);
    const addressState = (settingsRow?.address as { state?: string } | null | undefined)?.state;
    const shippingAddr = (order.shippingAddress ?? {}) as { state?: string };
    const rawTaxObj = ((settingsRow?.checkout ?? {}) as Record<string, unknown>).tax as Record<string, unknown> | undefined;

    let destinationState: string;
    let originState: string;

    if (gstV2Enabled) {
      const explicitDest = input.placeOfSupplyState ?? order.placeOfSupplyState ?? shippingAddr.state;
      if (!explicitDest || !explicitDest.trim()) {
        throw new Error("Bad Request: Shipping destination state is required to calculate GST.");
      }
      destinationState = explicitDest.trim();

      const explicitOrigin = input.sellerState ?? storeCfg.tax.sellerState ?? addressState;
      if (!explicitOrigin || !explicitOrigin.trim()) {
        throw new Error("Bad Request: Seller state is missing. Please configure your registered state in Settings > Taxes.");
      }
      originState = explicitOrigin.trim();
    } else {
      // Flag-off: preserve legacy Delhi default
      destinationState = input.placeOfSupplyState ?? order.placeOfSupplyState ?? shippingAddr.state ?? "Delhi";
      originState = input.sellerState ?? storeCfg.tax.sellerState ?? addressState ?? "Delhi";
    }

    const sellerGstin = input.sellerGstin ?? storeCfg.tax.gstin ?? undefined;
    const pricesIncludeTax = input.pricesIncludeTax ?? storeCfg.tax.pricesIncludeTax;
    const isInterState = normalizeState(originState) !== normalizeState(destinationState);

    // 3. Financial year and sequence numbering (PLAN §11.2)
    const fy = getIndianFinancialYear(new Date());
    const invoiceType = input.type ?? "invoice";
    const sequenceKind = invoiceType === "credit_note" ? "credit_note" : "invoice";
    const prefix = invoiceType === "credit_note" ? `CN-${fy}-` : `INV-${fy}-`;

    const seq = await allocateSequenceNumber(db, ctx.tenantId, sequenceKind, fy, {
      defaultPrefix: prefix,
      defaultPadding: 4,
    });

    // 4. Calculate lines
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalDiscount = 0;
    let computedSubtotal = 0;

    // Credit Note quantity mapping if creditLines provided
    const creditQtyMap = input.creditLines
      ? new Map(input.creditLines.map((cl) => [cl.orderItemId, cl.quantity]))
      : null;

    const lineCalculations: TaxLineCalculation[] = [];

    for (const it of items) {
      // If generating credit note with specific returned items, filter/scale
      let qty = it.quantity;
      if (creditQtyMap) {
        qty = creditQtyMap.get(it.id) ?? 0;
        if (qty <= 0) continue;
      }

      // Proportional discount for partial return
      const proportionalDiscount = Math.round((it.discountAmount * qty) / Math.max(1, it.quantity));
      totalDiscount += proportionalDiscount;

      let rateBps: number;
      let hsn: string | null = it.hsn ?? null;

      if (gstV2Enabled) {
        if (it.taxRateBps != null && it.taxRateBps > 0) {
          rateBps = it.taxRateBps;
        } else {
          // Resolve from store tax classes
          const resolved = await resolveTaxClass(db, ctx.tenantId, null);
          rateBps = resolved.rateBps;
          if (!hsn) hsn = resolved.defaultHsn;
        }
      } else {
        rateBps = it.taxRateBps || 1800; // Legacy default
      }

      const calc = calculateGstLineItem({
        orderItemId: it.id,
        variantId: it.variantId,
        sku: it.sku,
        productTitle: it.productTitle,
        hsn,
        quantity: qty,
        unitPrice: it.unitPrice,
        discountAmount: proportionalDiscount,
        taxRateBps: rateBps,
        pricesIncludeTax,
        isInterState,
      });

      computedSubtotal += it.unitPrice * qty;
      totalTaxable += calc.taxableAmount;
      totalCgst += calc.cgst;
      totalSgst += calc.sgst;
      totalIgst += calc.igst;

      lineCalculations.push(calc);
    }

    // 5. Shipping tax treatment
    // Credit notes do not credit shipping unless explicitly specified (no freight return)
    const isCreditNote = invoiceType === "credit_note";
    const shippingTotal = isCreditNote ? 0 : order.shippingTotal;
    let shippingTaxable = shippingTotal;
    let shippingCgst = 0;
    let shippingSgst = 0;
    let shippingIgst = 0;

    if (shippingTotal > 0) {
      let shippingTaxRate = 1800;
      if (gstV2Enabled) {
        const rawShippingTaxMode = (rawTaxObj?.shippingTax as string | undefined) ?? "highest_line_rate";
        if (rawShippingTaxMode === "none") {
          shippingTaxRate = 0;
        } else {
          // Highest line rate
          shippingTaxRate = lineCalculations.reduce((max, l) => Math.max(max, l.taxRateBps), 0);
        }
      }

      if (shippingTaxRate === 0) {
        shippingTaxable = shippingTotal;
      } else if (pricesIncludeTax) {
        shippingTaxable = Math.round((shippingTotal * 10000) / (10000 + shippingTaxRate));
        const shippingTax = shippingTotal - shippingTaxable;
        if (isInterState) {
          shippingIgst = shippingTax;
        } else {
          shippingCgst = Math.floor(shippingTax / 2);
          shippingSgst = shippingTax - shippingCgst;
        }
      } else {
        const shippingTax = Math.round((shippingTaxable * shippingTaxRate) / 10000);
        if (isInterState) {
          shippingIgst = shippingTax;
        } else {
          shippingCgst = Math.floor(shippingTax / 2);
          shippingSgst = shippingTax - shippingCgst;
        }
      }
    }

    const grandTaxable = totalTaxable + shippingTaxable;
    const grandCgst = totalCgst + shippingCgst;
    const grandSgst = totalSgst + shippingSgst;
    const grandIgst = totalIgst + shippingIgst;
    const grandTax = grandCgst + grandSgst + grandIgst;
    const grandTotal = grandTaxable + grandTax;

    const multiplier = isCreditNote ? -1 : 1;

    const totals: InvoiceTotals = {
      subtotal: multiplier * (isCreditNote ? computedSubtotal : order.subtotal),
      discountTotal: multiplier * totalDiscount,
      taxableAmount: multiplier * grandTaxable,
      cgst: multiplier * grandCgst,
      sgst: multiplier * grandSgst,
      igst: multiplier * grandIgst,
      totalTax: multiplier * grandTax,
      shippingTaxable: multiplier * shippingTaxable,
      shippingCgst: multiplier * shippingCgst,
      shippingSgst: multiplier * shippingSgst,
      shippingIgst: multiplier * shippingIgst,
      shippingTotal: multiplier * shippingTotal,
      grandTotal: multiplier * grandTotal,
      isInterState,
    };

    // 6. Insert invoice / credit note record
    const [inserted] = await db
      .insert(invoices)
      .values({
        tenantId: ctx.tenantId,
        orderId: input.orderId,
        number: seq.formatted,
        fy,
        type: invoiceType,
        sellerGstin: sellerGstin ?? null,
        buyerGstin: input.buyerGstin ?? null,
        placeOfSupplyState: destinationState,
        totals: totals as unknown as Record<string, unknown>,
        returnId: input.returnId ?? null,
        parentInvoiceId: input.parentInvoiceId ?? null,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to insert invoice");
    }

    return {
      invoiceId: inserted.id,
      number: seq.formatted,
      fy,
      type: invoiceType,
      issuedAt: inserted.issuedAt,
      totals,
      lineItems: lineCalculations,
    };
  };

  if (tx) {
    return runner(tx);
  }
  return withTenant(rt._db.db, ctx.tenantId, runner);
}
