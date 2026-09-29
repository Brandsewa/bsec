import { eq, and } from "drizzle-orm";
import {
  fulfillments,
  orders,
  orderEvents,
  trackingEvents,
  withTenant,
  type Db,
  QUEUE_NAMES,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";

export const FULFILLMENT_STATUSES = [
  "pending",
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "rto",
  "rto_delivered",
  "cancelled",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/**
 * Exact allowed fulfillment state transitions per PLAN §11.1:
 * - pending → label_created → picked_up → in_transit → out_for_delivery → delivered
 * - in_transit/out_for_delivery → rto → rto_delivered
 * - pending/label_created → cancelled
 */
const ALLOWED_FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  pending: ["label_created", "cancelled"],
  label_created: ["picked_up", "cancelled"],
  picked_up: ["in_transit"],
  in_transit: ["out_for_delivery", "delivered", "rto"],
  out_for_delivery: ["delivered", "rto"],
  delivered: [],
  rto: ["rto_delivered"],
  rto_delivered: [],
  cancelled: [],
};

export function isValidFulfillmentTransition(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return ALLOWED_FULFILLMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidFulfillmentStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFulfillmentStateTransitionError";
  }
}

export type FulfillmentTransitionEvent =
  | { type: "fulfillment.create_label"; labelKey?: string | undefined; awb?: string | undefined; carrier?: string | undefined; trackingUrl?: string | undefined; data?: Record<string, unknown> | undefined }
  | { type: "fulfillment.pick_up"; data?: Record<string, unknown> | undefined }
  | { type: "fulfillment.transit"; location?: string | undefined; message?: string | undefined; data?: Record<string, unknown> | undefined }
  | { type: "fulfillment.out_for_delivery"; location?: string | undefined; message?: string | undefined; data?: Record<string, unknown> | undefined }
  | { type: "fulfillment.deliver"; deliveredAt?: Date | undefined; data?: Record<string, unknown> | undefined }
  | { type: "fulfillment.rto"; reason?: string | undefined; data?: Record<string, unknown> | undefined }
  | { type: "fulfillment.rto_deliver"; data?: Record<string, unknown> | undefined }
  | { type: "fulfillment.cancel"; reason?: string | undefined; data?: Record<string, unknown> | undefined };

export interface TransitionFulfillmentResult {
  fulfillmentId: string;
  orderId: string;
  previousStatus: string;
  newStatus: string;
  orderEventId: string;
}

/**
 * Single authoritative transition function for fulfillments (PLAN §11.1).
 * Checks the allowed transitions table, updates fulfillment status, logs order_events
 * and tracking_events, updates order fulfillment_status rollup, and emits domain events.
 */
export async function transitionFulfillment(
  rt: Runtime,
  ctx: TenantContext,
  fulfillmentId: string,
  event: FulfillmentTransitionEvent,
  tx?: Db,
): Promise<TransitionFulfillmentResult> {
  const runner = async (db: Db): Promise<TransitionFulfillmentResult> => {
    // 1. Fetch current fulfillment
    const [fulfillment] = await db
      .select()
      .from(fulfillments)
      .where(and(eq(fulfillments.tenantId, ctx.tenantId), eq(fulfillments.id, fulfillmentId)));

    if (!fulfillment) {
      throw new Error(`Fulfillment not found: ${fulfillmentId}`);
    }

    const previousStatus = fulfillment.status as FulfillmentStatus;
    let targetStatus: FulfillmentStatus;
    let eventMessage: string;
    let isTrackingEvent = false;

    switch (event.type) {
      case "fulfillment.create_label":
        targetStatus = "label_created";
        eventMessage = event.awb ? `Shipping label generated (AWB: ${event.awb})` : "Shipping label generated";
        break;
      case "fulfillment.pick_up":
        targetStatus = "picked_up";
        eventMessage = "Package picked up by courier";
        isTrackingEvent = true;
        break;
      case "fulfillment.transit":
        targetStatus = "in_transit";
        eventMessage = event.message ?? "Package in transit";
        isTrackingEvent = true;
        break;
      case "fulfillment.out_for_delivery":
        targetStatus = "out_for_delivery";
        eventMessage = event.message ?? "Package out for delivery";
        isTrackingEvent = true;
        break;
      case "fulfillment.deliver":
        targetStatus = "delivered";
        eventMessage = "Package successfully delivered";
        isTrackingEvent = true;
        break;
      case "fulfillment.rto":
        targetStatus = "rto";
        eventMessage = event.reason ? `Return to Origin initiated: ${event.reason}` : "Return to Origin (RTO) initiated";
        isTrackingEvent = true;
        break;
      case "fulfillment.rto_deliver":
        targetStatus = "rto_delivered";
        eventMessage = "Package delivered back to origin (RTO complete)";
        isTrackingEvent = true;
        break;
      case "fulfillment.cancel":
        targetStatus = "cancelled";
        eventMessage = event.reason ? `Fulfillment cancelled: ${event.reason}` : "Fulfillment cancelled";
        break;
      default:
        throw new InvalidFulfillmentStateTransitionError(
          `Unsupported fulfillment event type: ${(event as { type: string }).type}`,
        );
    }

    if (!isValidFulfillmentTransition(previousStatus, targetStatus)) {
      throw new InvalidFulfillmentStateTransitionError(
        `Invalid fulfillment transition from '${previousStatus}' to '${targetStatus}'`,
      );
    }

    // 2. Update fulfillment record
    const updateData: Partial<typeof fulfillments.$inferInsert> = {
      status: targetStatus,
      updatedAt: new Date(),
    };
    if (event.type === "fulfillment.create_label") {
      if (event.labelKey) updateData.labelKey = event.labelKey;
      if (event.awb) updateData.awb = event.awb;
      if (event.carrier) updateData.carrier = event.carrier;
      if (event.trackingUrl) updateData.trackingUrl = event.trackingUrl;
    } else if (event.type === "fulfillment.pick_up" || event.type === "fulfillment.transit") {
      if (!fulfillment.shippedAt) updateData.shippedAt = new Date();
    } else if (event.type === "fulfillment.deliver") {
      updateData.deliveredAt = event.deliveredAt ?? new Date();
    }

    await db
      .update(fulfillments)
      .set(updateData)
      .where(and(eq(fulfillments.tenantId, ctx.tenantId), eq(fulfillments.id, fulfillmentId)));

    // 3. Optional tracking event append
    if (isTrackingEvent) {
      await db.insert(trackingEvents).values({
        tenantId: ctx.tenantId,
        fulfillmentId,
        status: targetStatus,
        location: (event as { location?: string }).location ?? null,
        message: eventMessage,
        occurredAt: new Date(),
        raw: (event.data ?? {}) as Record<string, unknown>,
      });
    }

    // 4. Update order fulfillment status rollup
    const orderFulfillments = await db
      .select({ status: fulfillments.status })
      .from(fulfillments)
      .where(and(eq(fulfillments.tenantId, ctx.tenantId), eq(fulfillments.orderId, fulfillment.orderId)));

    let rollupStatus = "unfulfilled";
    const nonCancelled = orderFulfillments.filter((f) => f.status !== "cancelled");
    if (nonCancelled.length > 0) {
      const allDelivered = nonCancelled.every((f) => f.status === "delivered");
      const anyDelivered = nonCancelled.some((f) => f.status === "delivered");
      const anyShipped = nonCancelled.some((f) => ["picked_up", "in_transit", "out_for_delivery"].includes(f.status));
      const anyRto = nonCancelled.some((f) => f.status === "rto" || f.status === "rto_delivered");

      if (allDelivered) {
        rollupStatus = "delivered";
      } else if (anyRto) {
        rollupStatus = "rto";
      } else if (anyDelivered || anyShipped) {
        rollupStatus = "partially_fulfilled";
      } else if (nonCancelled.every((f) => f.status === "label_created")) {
        rollupStatus = "fulfilled";
      } else {
        rollupStatus = "processing";
      }
    }

    await db
      .update(orders)
      .set({
        fulfillmentStatus: rollupStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.tenantId, ctx.tenantId), eq(orders.id, fulfillment.orderId)));

    // 5. Append order audit event
    const insertedEvents = await db
      .insert(orderEvents)
      .values({
        tenantId: ctx.tenantId,
        orderId: fulfillment.orderId,
        type: event.type,
        message: eventMessage,
        data: {
          fulfillmentId,
          awb: fulfillment.awb ?? (event as { awb?: string }).awb,
          carrier: fulfillment.carrier ?? (event as { carrier?: string }).carrier,
          ...event.data,
        },
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

    // 6. Enqueue domain events if pg-boss runtime is active
    if (rt._jobs) {
      if (targetStatus === "label_created" || targetStatus === "picked_up") {
        await rt._jobs.send(QUEUE_NAMES.FULFILLMENT_CREATED, {
          fulfillmentId,
          orderId: fulfillment.orderId,
          tenantId: ctx.tenantId,
        });
      } else if (targetStatus === "delivered") {
        await rt._jobs.send(QUEUE_NAMES.FULFILLMENT_DELIVERED, {
          fulfillmentId,
          orderId: fulfillment.orderId,
          tenantId: ctx.tenantId,
        });
      } else if (targetStatus === "rto") {
        await rt._jobs.send(QUEUE_NAMES.FULFILLMENT_RTO, {
          fulfillmentId,
          orderId: fulfillment.orderId,
          tenantId: ctx.tenantId,
        });
      }
    }

    return {
      fulfillmentId,
      orderId: fulfillment.orderId,
      previousStatus,
      newStatus: targetStatus,
      orderEventId: insertedEvents[0]?.id ?? "",
    };
  };

  if (tx) {
    return runner(tx);
  }
  return withTenant(rt._db.db, ctx.tenantId, runner);
}
