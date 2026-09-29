import { eq, sql } from "drizzle-orm";
import { type Db, webhookInbox, orders, orderEvents, withTenant, QUEUE_NAMES } from "@bs/db";
import { sanitizePaymentPayload } from "@bs/payments";
import { commitReservation } from "../catalog/inventory-reservations.ts";
import type { Jobs } from "../jobs.ts";

export interface ReceiveWebhookInput {
  provider: string;
  eventId: string;
  tenantId?: string | undefined;
  signatureValid: boolean;
  rawPayload: unknown;
}

export interface ReceiveWebhookResult {
  duplicate: boolean;
  inboxId?: string | undefined;
}

/**
 * Ingest an incoming webhook into webhook_inbox (PLAN §11.4).
 *
 * Sequence:
 *   Receive -> verify signature -> sanitize -> insert with ON CONFLICT (provider, event_id) DO NOTHING ->
 *   reply 200 immediately -> enqueue processing.
 */
export async function receiveWebhook(
  db: Db,
  input: ReceiveWebhookInput,
  jobs?: Jobs | undefined,
): Promise<ReceiveWebhookResult> {
  const sanitized = sanitizePaymentPayload((input.rawPayload ?? {}) as Record<string, unknown>);

  // Notice: webhook_inbox is a platform table without RLS, so db directly executes query
  const res = await db.execute<{ id: string }>(sql`
    INSERT INTO webhook_inbox (
      provider,
      event_id,
      tenant_id,
      signature_valid,
      payload_sanitized,
      status
    )
    VALUES (
      ${input.provider},
      ${input.eventId},
      ${input.tenantId ?? null},
      ${input.signatureValid},
      ${JSON.stringify(sanitized)}::jsonb,
      'received'
    )
    ON CONFLICT (provider, event_id) DO NOTHING
    RETURNING id;
  `);

  const inserted = res.rows[0];
  if (!inserted) {
    return { duplicate: true };
  }

  if (jobs) {
    await jobs.send(QUEUE_NAMES.WEBHOOK_PROCESS, {
      inboxId: inserted.id,
      provider: input.provider,
      eventId: input.eventId,
      tenantId: input.tenantId,
    });
  }

  return {
    duplicate: false,
    inboxId: inserted.id,
  };
}

/**
 * Process a webhook inbox record idempotently in the background (PLAN §11.4).
 */
interface WebhookPayloadStructure {
  event?: string;
  order_id?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        notes?: {
          order_id?: string;
          tenant_id?: string;
        };
      };
    };
    order?: {
      entity?: {
        id?: string;
        notes?: {
          order_id?: string;
          tenant_id?: string;
        };
      };
    };
  };
  [key: string]: unknown;
}

export async function processWebhookInboxItem(
  db: Db,
  inboxId: string,
): Promise<{ success?: boolean; alreadyProcessed?: boolean; error?: string }> {
  // 1. Atomically claim item for processing
  const claimRes = await db.execute<{
    id: string;
    provider: string;
    event_id: string;
    tenant_id: string | null;
    signature_valid: boolean;
    payload_sanitized: unknown;
    status: string;
  }>(sql`
    UPDATE webhook_inbox
       SET status = 'processing',
           attempts = attempts + 1,
           updated_at = now()
     WHERE id = ${inboxId}
       AND status IN ('received', 'failed')
    RETURNING *;
  `);

  const item = claimRes.rows[0];
  if (!item) {
    // Check if already processed
    const [existing] = await db
      .select({ status: webhookInbox.status })
      .from(webhookInbox)
      .where(eq(webhookInbox.id, inboxId));

    if (existing?.status === "processed") {
      return { alreadyProcessed: true };
    }
    return { alreadyProcessed: false };
  }

  // Reject unverified / forged webhook signatures before any business logic executes (PLAN §11.4)
  if (!item.signature_valid) {
    await db
      .update(webhookInbox)
      .set({
        status: "failed",
        error: "Invalid webhook signature",
        updatedAt: new Date(),
      })
      .where(eq(webhookInbox.id, inboxId));

    return { success: false, error: "Invalid webhook signature" };
  }

  try {
    const payload = (item.payload_sanitized ?? {}) as WebhookPayloadStructure;
    const provider = item.provider;

    if (provider === "razorpay") {
      const eventType = payload.event;
      if (eventType === "payment.captured" || eventType === "order.paid") {
        const orderId =
          payload.order_id ||
          payload.payload?.payment?.entity?.notes?.order_id ||
          payload.payload?.payment?.entity?.order_id ||
          payload.payload?.order?.entity?.notes?.order_id;

        const tenantId = item.tenant_id;

        if (orderId && tenantId) {
          await withTenant(db, tenantId, async (tx) => {
            const [order] = await tx
              .select()
              .from(orders)
              .where(eq(orders.id, orderId));

            if (order && order.status === "pending") {
              // Transition order to confirmed and paymentStatus to paid
              await tx
                .update(orders)
                .set({
                  status: "confirmed",
                  paymentStatus: "paid",
                  updatedAt: new Date(),
                })
                .where(eq(orders.id, orderId));

              // Record event
              await tx.insert(orderEvents).values({
                tenantId,
                orderId,
                type: "order.confirm",
                message: "Order confirmed via payment webhook",
                actorType: "system",
                data: {
                  provider: "razorpay",
                  eventId: item.event_id,
                },
              });

              // Commit inventory reservation
              await commitReservation(db, tenantId, { orderId });
            }
          });
        }
      }
    } else if (provider === "cod") {
      const eventType = payload.event;
      if (eventType === "cod.confirmed") {
        const orderId = payload.order_id;
        const tenantId = item.tenant_id;

        if (orderId && tenantId) {
          await withTenant(db, tenantId, async (tx) => {
            const [order] = await tx
              .select()
              .from(orders)
              .where(eq(orders.id, orderId));

            if (order && order.status === "pending") {
              await tx
                .update(orders)
                .set({
                  status: "confirmed",
                  paymentStatus: "cod_pending",
                  updatedAt: new Date(),
                })
                .where(eq(orders.id, orderId));

              await tx.insert(orderEvents).values({
                tenantId,
                orderId,
                type: "order.confirm",
                message: "Order confirmed via COD",
                actorType: "system",
                data: { provider: "cod" },
              });

              await commitReservation(db, tenantId, { orderId });
            }
          });
        }
      }
    }

    // Mark processed
    await db
      .update(webhookInbox)
      .set({
        status: "processed",
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(webhookInbox.id, inboxId));

    return { success: true };
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    await db
      .update(webhookInbox)
      .set({
        status: "failed",
        error: errMessage,
        updatedAt: new Date(),
      })
      .where(eq(webhookInbox.id, inboxId));
    throw err;
  }
}
