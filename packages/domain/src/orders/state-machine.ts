import { eq, and, sql } from "drizzle-orm";
import {
  orders,
  orderEvents,
  paymentIntents,
  refunds,
  withTenant,
  type Db,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "processing",
  "partially_fulfilled",
  "fulfilled",
  "delivered",
  "cancelled",
  "returned",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_INTENT_STATUSES = [
  "created",
  "requires_action",
  "authorized",
  "captured",
  "partially_refunded",
  "refunded",
  "failed",
  "cancelled",
  "cod_pending",
  "cod_collected",
  "cod_failed",
] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

/**
 * Exact allowed order state transitions per PLAN §11.1:
 * - pending → confirmed (paid or COD confirmed)
 * - pending → cancelled (expired, customer, merchant)
 * - confirmed → processing → partially_fulfilled → fulfilled → delivered
 * - confirmed/processing → cancelled (only if nothing shipped; triggers refund)
 * - delivered → returned (when all items returned)
 */
const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["partially_fulfilled", "cancelled"],
  partially_fulfilled: ["fulfilled"],
  fulfilled: ["delivered"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

/**
 * Exact allowed payment intent state transitions per PLAN §11.1:
 * - created → requires_action → authorized → captured
 * - created/requires_action → failed
 * - authorized → cancelled (void)
 * - captured → partially_refunded → refunded
 * - COD: cod_pending → cod_collected | cod_failed (RTO)
 */
const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentIntentStatus, readonly PaymentIntentStatus[]> = {
  created: ["requires_action", "authorized", "captured", "failed"],
  requires_action: ["authorized", "captured", "failed"],
  authorized: ["captured", "cancelled"],
  captured: ["partially_refunded", "refunded"],
  partially_refunded: ["refunded"],
  cod_pending: ["cod_collected", "cod_failed"],
  cod_collected: [],
  cod_failed: [],
  failed: [],
  cancelled: [],
  refunded: [],
};

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isValidPaymentIntentTransition(
  from: PaymentIntentStatus,
  to: PaymentIntentStatus,
): boolean {
  return ALLOWED_PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateTransitionError";
  }
}

export type OrderTransitionEvent =
  | { type: "order.confirm"; reason?: string; data?: Record<string, unknown> }
  | { type: "order.process"; data?: Record<string, unknown> }
  | { type: "order.partially_fulfill"; data?: Record<string, unknown> }
  | { type: "order.fulfill"; data?: Record<string, unknown> }
  | { type: "order.deliver"; data?: Record<string, unknown> }
  | { type: "order.cancel"; reason: string; data?: Record<string, unknown> }
  | { type: "order.return"; reason?: string; data?: Record<string, unknown> }
  | {
      type: "payment.require_action";
      intentId: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "payment.authorize";
      intentId: string;
      providerPaymentId?: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "payment.capture";
      intentId: string;
      amount?: bigint | number;
      providerPaymentId?: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "payment.fail";
      intentId: string;
      errorCode?: string;
      errorMessage?: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "payment.cancel";
      intentId: string;
      reason?: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "payment.partial_refund";
      intentId: string;
      amount: bigint | number;
      reason?: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "payment.refund";
      intentId: string;
      amount: bigint | number;
      reason?: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "payment.cod_pending";
      intentId: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "payment.cod_collect";
      intentId: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "payment.cod_fail";
      intentId: string;
      reason?: string;
      data?: Record<string, unknown>;
    };

export interface TransitionOrderResult {
  orderId: string;
  previousStatus: string;
  newStatus: string;
  orderEventId: string;
}

/**
 * The single authoritative transition function per entity (PLAN §11.1).
 * Checks the allowed transitions table, enforces cross-entity guards,
 * writes an order_events row, and rejects everything else.
 */
export async function transitionOrder(
  rt: Runtime,
  ctx: TenantContext,
  orderId: string,
  event: OrderTransitionEvent,
  tx?: Db,
): Promise<TransitionOrderResult> {
  const runner = async (db: Db): Promise<TransitionOrderResult> => {
    // 1. Fetch current order
    const orderRows = await db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.id, orderId)));
    const order = orderRows[0];
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const previousStatus = order.status;
    let newStatus = order.status;
    let eventMessage = "";
    const eventData: Record<string, unknown> = { ...event.data };

    if (event.type.startsWith("order.")) {
      let targetStatus: OrderStatus;
      switch (event.type) {
        case "order.confirm":
          targetStatus = "confirmed";
          eventMessage = event.reason ? `Order confirmed: ${event.reason}` : "Order confirmed";
          break;
        case "order.process":
          targetStatus = "processing";
          eventMessage = "Order moved to processing";
          break;
        case "order.partially_fulfill":
          targetStatus = "partially_fulfilled";
          eventMessage = "Order partially fulfilled";
          break;
        case "order.fulfill":
          targetStatus = "fulfilled";
          eventMessage = "Order fulfilled";
          break;
        case "order.deliver":
          targetStatus = "delivered";
          eventMessage = "Order delivered";
          break;
        case "order.cancel":
          targetStatus = "cancelled";
          eventMessage = `Order cancelled: ${event.reason}`;
          eventData.cancelReason = event.reason;
          break;
        case "order.return":
          targetStatus = "returned";
          eventMessage = event.reason ? `Order returned: ${event.reason}` : "Order returned";
          break;
        default:
          throw new InvalidStateTransitionError(`Unsupported order event type: ${(event as { type: string }).type}`);
      }

      if (!isValidOrderTransition(previousStatus as OrderStatus, targetStatus)) {
        throw new InvalidStateTransitionError(
          `Invalid order transition from '${previousStatus}' to '${targetStatus}'`,
        );
      }

      // Cross-entity guards (PLAN §11.1):
      // Guard 1: an order cannot be cancelled once any fulfillment is past label_created
      if (targetStatus === "cancelled") {
        const shippedStatuses = [
          "picked_up",
          "in_transit",
          "out_for_delivery",
          "delivered",
          "rto",
          "rto_delivered",
        ];
        if (shippedStatuses.includes(order.fulfillmentStatus)) {
          throw new InvalidStateTransitionError(
            `Cannot cancel order with fulfillment status '${order.fulfillmentStatus}' (past label_created)`,
          );
        }

        // Check real fulfillments rows
        const { fulfillments } = await import("@bs/db");
        const activeFulfillments = await db
          .select({ status: fulfillments.status })
          .from(fulfillments)
          .where(and(eq(fulfillments.tenantId, ctx.tenantId), eq(fulfillments.orderId, orderId)));

        for (const f of activeFulfillments) {
          if (shippedStatuses.includes(f.status)) {
            throw new InvalidStateTransitionError(
              `Cannot cancel order with fulfillment in status '${f.status}' (past label_created)`,
            );
          }
        }
      }

      // Guard 2: an order cannot be delivered while any fulfillment is pending
      if (targetStatus === "delivered") {
        if (order.fulfillmentStatus === "pending") {
          throw new InvalidStateTransitionError(
            `Cannot mark order as delivered while fulfillment status is '${order.fulfillmentStatus}'`,
          );
        }

        const { fulfillments } = await import("@bs/db");
        const pendingFulfillments = await db
          .select({ status: fulfillments.status })
          .from(fulfillments)
          .where(and(eq(fulfillments.tenantId, ctx.tenantId), eq(fulfillments.orderId, orderId), eq(fulfillments.status, "pending")));

        if (pendingFulfillments.length > 0) {
          throw new InvalidStateTransitionError(
            "Cannot mark order as delivered while any fulfillment is pending",
          );
        }
      }

      newStatus = targetStatus;

      await db
        .update(orders)
        .set({
          status: targetStatus,
          cancelledAt: targetStatus === "cancelled" ? new Date() : order.cancelledAt,
          cancelReason: targetStatus === "cancelled" && "reason" in event ? (event.reason ?? null) : order.cancelReason,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.id, orderId)));
    } else if (event.type.startsWith("payment.")) {
      if (!("intentId" in event)) {
        throw new Error("intentId is required for payment events");
      }
      // Payment Intent Transition
      const intentRows = await db
        .select()
        .from(paymentIntents)
        .where(
          and(
            eq(paymentIntents.tenantId, ctx.tenantId),
            eq(paymentIntents.id, event.intentId),
            eq(paymentIntents.orderId, orderId),
          ),
        );
      const intent = intentRows[0];
      if (!intent) {
        throw new Error(`Payment intent not found: ${event.intentId}`);
      }

      const prevPaymentStatus = intent.status as PaymentIntentStatus;
      let targetPaymentStatus: PaymentIntentStatus;

      switch (event.type) {
        case "payment.require_action":
          targetPaymentStatus = "requires_action";
          eventMessage = "Payment requires additional customer action";
          break;
        case "payment.authorize":
          targetPaymentStatus = "authorized";
          eventMessage = "Payment authorized";
          if (event.providerPaymentId) eventData.providerPaymentId = event.providerPaymentId;
          break;
        case "payment.capture":
          targetPaymentStatus = "captured";
          eventMessage = `Payment captured for amount ${event.amount ?? intent.amount}`;
          if (event.providerPaymentId) eventData.providerPaymentId = event.providerPaymentId;
          break;
        case "payment.fail":
          targetPaymentStatus = "failed";
          eventMessage = `Payment failed: ${event.errorMessage ?? event.errorCode ?? "unknown"}`;
          break;
        case "payment.cancel":
          targetPaymentStatus = "cancelled";
          eventMessage = `Payment voided/cancelled: ${event.reason ?? ""}`;
          break;
        case "payment.partial_refund":
          targetPaymentStatus = "partially_refunded";
          eventMessage = `Payment partially refunded: ${event.amount}`;
          break;
        case "payment.refund":
          targetPaymentStatus = "refunded";
          eventMessage = `Payment refunded: ${event.amount}`;
          break;
        case "payment.cod_pending":
          targetPaymentStatus = "cod_pending";
          eventMessage = "COD payment pending collection on delivery";
          break;
        case "payment.cod_collect":
          targetPaymentStatus = "cod_collected";
          eventMessage = "COD payment collected successfully";
          break;
        case "payment.cod_fail":
          targetPaymentStatus = "cod_failed";
          eventMessage = `COD payment collection failed: ${event.reason ?? "RTO"}`;
          break;
        default:
          throw new InvalidStateTransitionError(
            `Unsupported payment event type: ${(event as { type: string }).type}`,
          );
      }

      if (!isValidPaymentIntentTransition(prevPaymentStatus, targetPaymentStatus)) {
        throw new InvalidStateTransitionError(
          `Invalid payment intent transition from '${prevPaymentStatus}' to '${targetPaymentStatus}'`,
        );
      }

      // Guard 3: refunds cannot exceed captured amount
      if (targetPaymentStatus === "refunded" || targetPaymentStatus === "partially_refunded") {
        const refundAmount = Number((event as { amount: bigint | number }).amount);
        const capturedAmount = Number(intent.amount);

        const existingRefundRows = await db
          .select({ total: sql<string>`coalesce(sum(${refunds.amount}), 0)` })
          .from(refunds)
          .where(
            and(
              eq(refunds.tenantId, ctx.tenantId),
              eq(refunds.intentId, intent.id),
              eq(refunds.status, "processed"),
            ),
          );
        const alreadyRefunded = Number(existingRefundRows[0]?.total ?? 0);

        if (alreadyRefunded + refundAmount > capturedAmount) {
          throw new InvalidStateTransitionError(
            `Refund amount ${alreadyRefunded + refundAmount} exceeds captured amount ${capturedAmount}`,
          );
        }
      }

      await db
        .update(paymentIntents)
        .set({
          status: targetPaymentStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(paymentIntents.tenantId, ctx.tenantId),
            eq(paymentIntents.id, intent.id),
          ),
        );

      // Also reflect on orders.payment_status
      let orderPaymentStatus = order.paymentStatus;
      if (targetPaymentStatus === "captured") {
        orderPaymentStatus = "paid";
      } else if (targetPaymentStatus === "authorized") {
        orderPaymentStatus = "authorized";
      } else if (targetPaymentStatus === "failed") {
        orderPaymentStatus = "failed";
      } else if (targetPaymentStatus === "refunded") {
        orderPaymentStatus = "refunded";
      } else if (targetPaymentStatus === "partially_refunded") {
        orderPaymentStatus = "partially_refunded";
      } else if (targetPaymentStatus === "cod_pending") {
        orderPaymentStatus = "cod_pending";
      } else if (targetPaymentStatus === "cod_collected") {
        orderPaymentStatus = "cod_collected";
      }

      await db
        .update(orders)
        .set({
          paymentStatus: orderPaymentStatus,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.id, orderId)));
    }

    // Write audit event
    const insertedEvents = await db
      .insert(orderEvents)
      .values({
        tenantId: ctx.tenantId,
        orderId,
        type: event.type,
        message: eventMessage,
        data: eventData,
        actorType: ctx.actor?.type ?? "system",
        actorId:
          ctx.actor && "userId" in ctx.actor
            ? ctx.actor.userId
            : ctx.actor && "id" in ctx.actor
              ? (ctx.actor as { id: string }).id
              : null,
        visibleToCustomer: true,
      })
      .returning({ id: orderEvents.id });

    return {
      orderId,
      previousStatus,
      newStatus,
      orderEventId: insertedEvents[0]?.id ?? "",
    };
  };

  if (tx) {
    return runner(tx);
  }
  return withTenant(rt._db.db, ctx.tenantId, runner);
}

