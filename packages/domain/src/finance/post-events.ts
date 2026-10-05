import { and, eq, lte, ne } from "drizzle-orm";
import { schema, type withTenant } from "@bs/db";
import {
  decomposeOrder,
  orderPaidPostings,
  refundPostings,
  restockCostPostings,
  expensePostings,
  type PostingOrderInput,
  type PostingRefundInput,
  type RefundAlreadyReversed,
} from "./postings.ts";
import { postLedgerEntries } from "./ledger.ts";

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

/**
 * Loads an order with its line items and posts revenue, tax, shipping, and COGS entries.
 * Idempotent: safe to replay anytime.
 */
export async function postOrderEvent(
  tx: Tx,
  tenantId: string,
  orderId: string,
): Promise<number> {
  const [order] = await tx
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)))
    .limit(1);

  if (!order) return 0;

  // Only post if money was collected (paid, cod_collected, or delivered)
  const isPaid =
    order.paymentStatus === "paid" ||
    order.paymentStatus === "cod_collected" ||
    order.status === "delivered";

  if (!isPaid) return 0;

  const items = await tx
    .select()
    .from(schema.orderItems)
    .where(
      and(
        eq(schema.orderItems.tenantId, tenantId),
        eq(schema.orderItems.orderId, orderId),
      ),
    );

  const [intent] = await tx
    .select({ provider: schema.paymentIntents.provider })
    .from(schema.paymentIntents)
    .where(
      and(
        eq(schema.paymentIntents.tenantId, tenantId),
        eq(schema.paymentIntents.orderId, orderId),
      ),
    )
    .limit(1);

  const isCod =
    intent?.provider === "cod" ||
    order.paymentStatus === "cod_collected" ||
    order.source === "cod";

  const postingOrder: PostingOrderInput = {
    id: order.id,
    orderNumber: order.number,
    currency: order.currency,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    codFee: order.codFee,
    taxTotal: order.taxTotal,
    grandTotal: order.grandTotal,
    paymentMethod: isCod ? "cod" : "online",
    paidAt: order.updatedAt,
    placedAt: order.placedAt,
    items: items.map((it) => ({
      variantId: it.variantId,
      quantity: it.quantity,
      costPrice: it.costPrice != null ? Number(it.costPrice) : null,
    })),
  };

  const postings = orderPaidPostings({ order: postingOrder });
  return await postLedgerEntries(tx, tenantId, postings, { strict: false });
}

/**
 * Loads a refund, its parent order, and prior refunds on that order,
 * and posts prorated balancing reversal entries.
 */
export async function postRefundEvent(
  tx: Tx,
  tenantId: string,
  refundId: string,
): Promise<number> {
  const [refund] = await tx
    .select()
    .from(schema.refunds)
    .where(
      and(
        eq(schema.refunds.tenantId, tenantId),
        eq(schema.refunds.id, refundId),
      ),
    )
    .limit(1);

  if (!refund || refund.status !== "succeeded") return 0;

  const [order] = await tx
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.tenantId, tenantId),
        eq(schema.orders.id, refund.orderId),
      ),
    )
    .limit(1);

  if (!order) return 0;

  // Load prior successful refunds for this order to calculate remaining headroom
  const priorRefunds = await tx
    .select()
    .from(schema.refunds)
    .where(
      and(
        eq(schema.refunds.tenantId, tenantId),
        eq(schema.refunds.orderId, order.id),
        eq(schema.refunds.status, "succeeded"),
        ne(schema.refunds.id, refund.id),
        lte(schema.refunds.createdAt, refund.createdAt),
      ),
    );

  const [intent] = await tx
    .select({ provider: schema.paymentIntents.provider })
    .from(schema.paymentIntents)
    .where(
      and(
        eq(schema.paymentIntents.tenantId, tenantId),
        eq(schema.paymentIntents.orderId, order.id),
      ),
    )
    .limit(1);

  const isCod =
    intent?.provider === "cod" ||
    order.paymentStatus === "cod_collected";

  const postingOrder: PostingOrderInput = {
    id: order.id,
    orderNumber: order.number,
    currency: order.currency,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    codFee: order.codFee,
    taxTotal: order.taxTotal,
    grandTotal: order.grandTotal,
    paymentMethod: isCod ? "cod" : "online",
  };

  const decomp = decomposeOrder(postingOrder);
  let totalPriorMerchandise = 0;
  let totalPriorTax = 0;
  let totalPriorShipping = 0;

  for (const pr of priorRefunds) {
    const priorHeadroomMerchandise = Math.max(0, decomp.merchandise - totalPriorMerchandise);
    const priorHeadroomTax = Math.max(0, decomp.tax - totalPriorTax);
    const priorHeadroomShipping = Math.max(0, decomp.shipping - totalPriorShipping);
    const priorTotalHeadroom = priorHeadroomMerchandise + priorHeadroomTax + priorHeadroomShipping;

    if (priorTotalHeadroom > 0) {
      const priorEffective = Math.min(Number(pr.amount), priorTotalHeadroom);
      const parts = [priorHeadroomMerchandise, priorHeadroomTax, priorHeadroomShipping];
      const sum = parts.reduce((a, b) => a + b, 0);
      const [pMerch = 0, pTax = 0, pShip = 0] = parts;
      if (sum > 0) {
        totalPriorMerchandise += Math.floor((priorEffective * pMerch) / sum);
        totalPriorTax += Math.floor((priorEffective * pTax) / sum);
        totalPriorShipping += Math.floor((priorEffective * pShip) / sum);
      }
    }
  }

  const alreadyReversed: RefundAlreadyReversed = {
    merchandise: totalPriorMerchandise,
    tax: totalPriorTax,
    shipping: totalPriorShipping,
  };

  const postingRefund: PostingRefundInput = {
    id: refund.id,
    amount: Number(refund.amount),
    method: refund.method,
    reference: refund.reference,
    date: refund.createdAt,
  };

  const postings = refundPostings({
    order: postingOrder,
    refund: postingRefund,
    alreadyReversed,
  });

  return await postLedgerEntries(tx, tenantId, postings, { strict: false });
}

/**
 * Loads a restocked return and posts inventory restoration against cost_of_goods.
 */
export async function postRestockEvent(
  tx: Tx,
  tenantId: string,
  returnId: string,
): Promise<number> {
  const [ret] = await tx
    .select({ orderId: schema.returns.orderId, number: schema.returns.number })
    .from(schema.returns)
    .where(
      and(
        eq(schema.returns.tenantId, tenantId),
        eq(schema.returns.id, returnId),
      ),
    )
    .limit(1);

  if (!ret) return 0;

  const lines = await tx
    .select({
      quantity: schema.returnItems.quantity,
      costPrice: schema.orderItems.costPrice,
    })
    .from(schema.returnItems)
    .innerJoin(
      schema.orderItems,
      and(
        eq(schema.orderItems.tenantId, schema.returnItems.tenantId),
        eq(schema.orderItems.id, schema.returnItems.orderItemId),
      ),
    )
    .where(
      and(
        eq(schema.returnItems.tenantId, tenantId),
        eq(schema.returnItems.returnId, returnId),
        eq(schema.returnItems.restock, true),
      ),
    );

  let restockedCost = 0;
  for (const line of lines) {
    if (line.costPrice != null && Number(line.costPrice) > 0) {
      restockedCost += Math.trunc(Number(line.costPrice)) * Math.max(0, line.quantity);
    }
  }

  if (restockedCost <= 0) return 0;

  const postings = restockCostPostings({
    orderId: ret.orderId,
    reason: `return-${returnId}`,
    items: lines.map((l) => ({
      quantity: l.quantity,
      costPrice: l.costPrice != null ? Number(l.costPrice) : null,
    })),
    postedCogs: restockedCost,
    alreadyRestockedCogs: 0,
  });

  return await postLedgerEntries(tx, tenantId, postings, { strict: false });
}

/**
 * Loads an expense row and posts its initial ledger entry.
 */
export async function postExpenseEvent(
  tx: Tx,
  tenantId: string,
  expenseId: string,
): Promise<number> {
  const [expense] = await tx
    .select()
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.tenantId, tenantId),
        eq(schema.expenses.id, expenseId),
      ),
    )
    .limit(1);

  if (!expense) return 0;

  const postings = expensePostings({ expense });
  return await postLedgerEntries(tx, tenantId, postings, { strict: false });
}

/**
 * Unified event dispatcher for the pg-boss finance.post queue and reconcile passes.
 */
export async function handleFinancePost(
  tx: Tx,
  tenantId: string,
  payload: { kind: string; id: string },
): Promise<number> {
  const { kind, id } = payload;
  switch (kind) {
    case "order":
      return await postOrderEvent(tx, tenantId, id);
    case "refund":
      return await postRefundEvent(tx, tenantId, id);
    case "restock":
      return await postRestockEvent(tx, tenantId, id);
    case "expense":
      return await postExpenseEvent(tx, tenantId, id);
    case "adjustment":
      // Adjustments are posted synchronously by the admin mutation
      return 0;
    default:
      return 0;
  }
}
