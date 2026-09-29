import { eq, and } from "drizzle-orm";
import {
  returns,
  orderEvents,
  withTenant,
  type Db,
  QUEUE_NAMES,
} from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";

export const RETURN_STATUSES = [
  "requested",
  "approved",
  "rejected",
  "picked_up",
  "received",
  "refunded",
  "replaced",
  "closed",
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/**
 * Exact allowed return state transitions per PLAN §11.1:
 * - requested → approved | rejected
 * - approved → picked_up → received → refunded | replaced → closed
 */
const ALLOWED_RETURN_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  requested: ["approved", "rejected"],
  approved: ["picked_up"],
  rejected: ["closed"],
  picked_up: ["received"],
  received: ["refunded", "replaced"],
  refunded: ["closed"],
  replaced: ["closed"],
  closed: [],
};

export function isValidReturnTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): boolean {
  return ALLOWED_RETURN_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidReturnStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReturnStateTransitionError";
  }
}

export type ReturnTransitionEvent =
  | { type: "return.approve"; adminNote?: string | undefined; data?: Record<string, unknown> | undefined }
  | { type: "return.reject"; reason: string; adminNote?: string | undefined; data?: Record<string, unknown> | undefined }
  | { type: "return.pick_up"; data?: Record<string, unknown> | undefined }
  | { type: "return.receive"; restock?: boolean | undefined; data?: Record<string, unknown> | undefined }
  | { type: "return.refund"; refundAmount?: number | undefined; data?: Record<string, unknown> | undefined }
  | { type: "return.replace"; replacementOrderId?: string | undefined; data?: Record<string, unknown> | undefined }
  | { type: "return.close"; note?: string | undefined; data?: Record<string, unknown> | undefined };

export interface TransitionReturnResult {
  returnId: string;
  orderId: string;
  previousStatus: string;
  newStatus: string;
  orderEventId: string;
}

/**
 * Single authoritative transition function for returns (PLAN §11.1).
 * Checks the allowed transitions table, updates return status, logs order_events,
 * and emits domain events (return.requested, refund.processed).
 */
export async function transitionReturn(
  rt: Runtime,
  ctx: TenantContext,
  returnId: string,
  event: ReturnTransitionEvent,
  tx?: Db,
): Promise<TransitionReturnResult> {
  const runner = async (db: Db): Promise<TransitionReturnResult> => {
    // 1. Fetch current return
    const [ret] = await db
      .select()
      .from(returns)
      .where(and(eq(returns.tenantId, ctx.tenantId), eq(returns.id, returnId)));

    if (!ret) {
      throw new Error(`Return not found: ${returnId}`);
    }

    const previousStatus = ret.status as ReturnStatus;
    let targetStatus: ReturnStatus;
    let eventMessage: string;

    switch (event.type) {
      case "return.approve":
        targetStatus = "approved";
        eventMessage = "Return request approved by merchant";
        break;
      case "return.reject":
        targetStatus = "rejected";
        eventMessage = `Return request rejected: ${event.reason}`;
        break;
      case "return.pick_up":
        targetStatus = "picked_up";
        eventMessage = "Return package picked up from customer";
        break;
      case "return.receive":
        targetStatus = "received";
        eventMessage = "Return package received and inspected at warehouse";
        break;
      case "return.refund":
        targetStatus = "refunded";
        eventMessage = event.refundAmount
          ? `Return refunded (₹${(event.refundAmount / 100).toFixed(2)})`
          : "Return refunded";
        break;
      case "return.replace":
        targetStatus = "replaced";
        eventMessage = event.replacementOrderId
          ? `Replacement order created (${event.replacementOrderId})`
          : "Replacement order created";
        break;
      case "return.close":
        targetStatus = "closed";
        eventMessage = event.note ? `Return closed: ${event.note}` : "Return case closed";
        break;
      default:
        throw new InvalidReturnStateTransitionError(
          `Unsupported return event type: ${(event as { type: string }).type}`,
        );
    }

    if (!isValidReturnTransition(previousStatus, targetStatus)) {
      throw new InvalidReturnStateTransitionError(
        `Invalid return transition from '${previousStatus}' to '${targetStatus}'`,
      );
    }

    // 2. Update return row
    const updateValues: Partial<typeof returns.$inferInsert> = {
      status: targetStatus,
      updatedAt: new Date(),
    };
    if ("adminNote" in event && event.adminNote) {
      updateValues.adminNote = event.adminNote;
    }

    await db
      .update(returns)
      .set(updateValues)
      .where(and(eq(returns.tenantId, ctx.tenantId), eq(returns.id, returnId)));

    // 3. Append order event
    const insertedEvents = await db
      .insert(orderEvents)
      .values({
        tenantId: ctx.tenantId,
        orderId: ret.orderId,
        type: event.type,
        message: eventMessage,
        data: {
          returnId,
          returnNumber: ret.number,
          resolution: ret.resolution,
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

    // 4. Enqueue domain events if pg-boss runtime is active
    if (rt._jobs) {
      if (targetStatus === "refunded") {
        await rt._jobs.send(QUEUE_NAMES.REFUND_PROCESSED, {
          returnId,
          refundId: returnId,
          refundAmount: event.type === "return.refund" ? event.refundAmount : undefined,
          orderId: ret.orderId,
          tenantId: ctx.tenantId,
        });
      }
    }

    return {
      returnId,
      orderId: ret.orderId,
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
