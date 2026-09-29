import { eq, and } from "drizzle-orm";
import {
  invoices,
  orders,
  orderItems,
  withTenant,
  type Db,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { allocateSequenceNumber } from "./sequences.ts";

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

export interface GenerateInvoiceInput {
  orderId: string;
  type?: "invoice" | "credit_note" | undefined;
  sellerGstin?: string | undefined;
  sellerState?: string | undefined; // default store state
  buyerGstin?: string | undefined;
  placeOfSupplyState?: string | undefined;
  pricesIncludeTax?: boolean | undefined;
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

/**
 * Normalizes state name to compare place of supply.
 */
function normalizeState(state?: string | null): string {
  if (!state) return "";
  return state.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

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

    const items = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.tenantId, ctx.tenantId), eq(orderItems.orderId, input.orderId)));

    // 2. Resolve place of supply (seller vs ship-to state)
    const shippingAddr = (order.shippingAddress ?? {}) as { state?: string };
    const destinationState = input.placeOfSupplyState ?? order.placeOfSupplyState ?? shippingAddr.state ?? "Delhi";
    const originState = input.sellerState ?? "Delhi"; // default
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

    const lineCalculations = items.map((it) => {
      totalDiscount += it.discountAmount;
      const calc = calculateGstLineItem({
        orderItemId: it.id,
        variantId: it.variantId,
        sku: it.sku,
        productTitle: it.productTitle,
        hsn: it.hsn,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountAmount: it.discountAmount,
        taxRateBps: it.taxRateBps || 1800, // default 18% standard GST if unset
        pricesIncludeTax: input.pricesIncludeTax ?? true,
        isInterState,
      });

      totalTaxable += calc.taxableAmount;
      totalCgst += calc.cgst;
      totalSgst += calc.sgst;
      totalIgst += calc.igst;

      return calc;
    });

    // 5. Shipping tax treatment (standard 18% GST on freight)
    const shippingTotal = order.shippingTotal;
    const shippingTaxRate = 1800; // 18%
    let shippingTaxable = shippingTotal;
    let shippingCgst = 0;
    let shippingSgst = 0;
    let shippingIgst = 0;

    if (shippingTotal > 0) {
      if (input.pricesIncludeTax ?? true) {
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

    const totals: InvoiceTotals = {
      subtotal: order.subtotal,
      discountTotal: totalDiscount,
      taxableAmount: grandTaxable,
      cgst: grandCgst,
      sgst: grandSgst,
      igst: grandIgst,
      totalTax: grandTax,
      shippingTaxable,
      shippingCgst,
      shippingSgst,
      shippingIgst,
      shippingTotal,
      grandTotal,
      isInterState,
    };

    // 6. Insert invoice record
    const [inserted] = await db
      .insert(invoices)
      .values({
        tenantId: ctx.tenantId,
        orderId: input.orderId,
        number: seq.formatted,
        fy,
        type: invoiceType,
        sellerGstin: input.sellerGstin ?? null,
        buyerGstin: input.buyerGstin ?? null,
        placeOfSupplyState: destinationState,
        totals: totals as unknown as Record<string, unknown>,
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
