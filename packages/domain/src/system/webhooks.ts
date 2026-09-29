import { and, eq, sql } from "drizzle-orm";
import { type Db, webhookInbox, orders, orderEvents, withTenant, QUEUE_NAMES } from "@bs/db";
import { sanitizePaymentPayload } from "@bs/payments";
import { commitReservation } from "../catalog/inventory-reservations.ts";
import type { Jobs } from "../jobs.ts";
import type { Runtime } from "../runtime.ts";

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
 * Resolves and validates webhook tenant ID (PLAN §11.4 / M7).
 *
 * Security boundary architecture:
 * Tenant identity is established by the per-tenant webhook secret. The claimed tenantId
 * selects which decrypted secret to verify against; the HMAC signature proves authenticity.
 * Where available, tenant ID is derived server-side directly from payload entity lookups (e.g. payment intents).
 * When entity identifiers are present alongside a claimed ID, ownership is checked under tenant RLS context.
 */
export async function resolveWebhookTenant(
  db: Db,
  params: {
    provider: string;
    claimedTenantId?: string | undefined;
    providerOrderId?: string | undefined;
    providerPaymentId?: string | undefined;
    shipmentId?: string | undefined;
    awb?: string | undefined;
    orderId?: string | undefined;
  },
): Promise<{ tenantId: string; verified: boolean }> {
  let claimedTenantId = params.claimedTenantId;

  // 1. Attempt payload derivation from database entity if claimedTenantId is not provided
  if (!claimedTenantId && params.providerOrderId) {
    const res = await db.execute<{ tenant_id: string }>(sql`
      SELECT tenant_id FROM payment_intents WHERE provider_order_id = ${params.providerOrderId} LIMIT 1;
    `);
    if (res.rows[0]?.tenant_id) {
      claimedTenantId = res.rows[0].tenant_id;
    }
  }

  if (!claimedTenantId && params.orderId) {
    const res = await db.execute<{ tenant_id: string }>(sql`
      SELECT tenant_id FROM orders WHERE id = ${params.orderId}::uuid LIMIT 1;
    `);
    if (res.rows[0]?.tenant_id) {
      claimedTenantId = res.rows[0].tenant_id;
    }
  }

  if (!claimedTenantId) {
    throw new Error(
      "Missing tenant identifier: tenantId is required for webhook signature verification and routing",
    );
  }

  // 2. Verify claimed or derived tenant exists in the database
  const tenantRes = await db.execute<{ id: string }>(sql`
    SELECT id FROM tenants WHERE id = ${claimedTenantId}::uuid LIMIT 1;
  `);
  if (!tenantRes.rows[0]?.id) {
    throw new Error(`Invalid tenant ID: ${claimedTenantId}`);
  }

  // 3. Tenant poisoning prevention: if payload references an entity (order, payment, shipment),
  // verify under tenant context (RLS) that this entity actually belongs to the claimed tenant.
  const hasEntityIdentifier = Boolean(
    params.providerOrderId ||
    params.providerPaymentId ||
    params.shipmentId ||
    params.awb ||
    params.orderId,
  );

  if (hasEntityIdentifier) {
    const matched = await withTenant(db, claimedTenantId, async (tx) => {
      if (params.provider === "razorpay") {
        if (params.providerOrderId) {
          const res = await tx.execute<{ id: string }>(sql`
            SELECT id FROM payment_intents
            WHERE provider_order_id = ${params.providerOrderId}
            LIMIT 1;
          `);
          return Boolean(res.rows[0]?.id);
        }
        if (params.providerPaymentId) {
          const res = await tx.execute<{ id: string }>(sql`
            SELECT pa.id
            FROM payment_attempts pa
            WHERE pa.provider_payment_id = ${params.providerPaymentId}
            LIMIT 1;
          `);
          return Boolean(res.rows[0]?.id);
        }
      } else if (params.provider === "shiprocket") {
        if (params.shipmentId) {
          const res = await tx.execute<{ id: string }>(sql`
            SELECT id FROM fulfillments
            WHERE shiprocket_shipment_id = ${params.shipmentId}
            LIMIT 1;
          `);
          return Boolean(res.rows[0]?.id);
        }
        if (params.awb) {
          const res = await tx.execute<{ id: string }>(sql`
            SELECT id FROM fulfillments
            WHERE awb = ${params.awb}
            LIMIT 1;
          `);
          return Boolean(res.rows[0]?.id);
        }
      } else if (params.provider === "cod") {
        if (params.orderId) {
          const res = await tx.execute<{ id: string }>(sql`
            SELECT id FROM orders
            WHERE id = ${params.orderId}::uuid
            LIMIT 1;
          `);
          return Boolean(res.rows[0]?.id);
        }
      }
      return true;
    });

    if (!matched) {
      throw new Error(
        `Tenant mismatch: webhook payload entity does not belong to claimed tenant ${claimedTenantId}`,
      );
    }
  }

  return { tenantId: claimedTenantId, verified: true };
}

/**
 * Ingest an incoming webhook into webhook_inbox (PLAN §11.4).
 *
 * Sequence:
 *   Receive -> verify signature -> sanitize -> insert (a validly-signed event replaces an unsigned
 *   placeholder with the same event_id, so forged pre-posts cannot block the real one; a duplicate of
 *   an already-valid event is ignored) -> reply 200 immediately -> enqueue processing.
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
    ON CONFLICT (provider, event_id) DO UPDATE
       SET signature_valid = EXCLUDED.signature_valid,
           payload_sanitized = EXCLUDED.payload_sanitized,
           tenant_id = EXCLUDED.tenant_id,
           status = 'received',
           updated_at = now()
     WHERE webhook_inbox.signature_valid = false
       AND EXCLUDED.signature_valid = true
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
    } else if (provider === "shiprocket") {
      const tenantId = item.tenant_id;
      const awb = (payload.awb as string | undefined) ?? (payload.awb_code as string | undefined);
      const currentStatus = String(payload.current_status ?? payload.status ?? "").toLowerCase();
      const location = (payload.current_location as string | undefined) ?? (payload.location as string | undefined);
      const message = (payload.scans as string | undefined) ?? (payload.activity as string | undefined) ?? `Shiprocket status: ${currentStatus}`;

      if (awb && tenantId) {
        await withTenant(db, tenantId, async (tx) => {
          const { fulfillments, trackingEvents } = await import("@bs/db");
          const { transitionFulfillment } = await import("../orders/fulfillment-state-machine.ts");

          const [fulfillment] = await tx
            .select()
            .from(fulfillments)
            .where(and(eq(fulfillments.tenantId, tenantId), eq(fulfillments.awb, awb)));

          if (fulfillment) {
            // Append tracking event
            await tx.insert(trackingEvents).values({
              tenantId,
              fulfillmentId: fulfillment.id,
              status: currentStatus,
              location: location ?? null,
              message,
              occurredAt: new Date(),
              raw: payload as Record<string, unknown>,
            });

            // Map status to fulfillment transition
            const rt = {
              service: "worker",
              _db: { db, close: async () => {} },
              close: async () => {},
            } as unknown as Runtime;
            const ctx = {
              tenantId,
              storeStatus: "live" as const,
              actor: { type: "system" as const },
              roles: [],
              permissions: [],
              requestId: "webhook_shiprocket",
            };

            if (currentStatus.includes("delivered") && fulfillment.status !== "delivered") {
              try {
                await transitionFulfillment(rt, ctx, fulfillment.id, {
                  type: "fulfillment.deliver",
                  deliveredAt: new Date(),
                  data: { awb, provider: "shiprocket" },
                }, tx);
              } catch {
                // Ignore if transition guard prevents or already progressed
              }
            } else if (currentStatus.includes("rto") && !fulfillment.status.startsWith("rto")) {
              try {
                await transitionFulfillment(rt, ctx, fulfillment.id, {
                  type: "fulfillment.rto",
                  reason: message,
                  data: { awb, provider: "shiprocket" },
                }, tx);
              } catch {
                // Ignore invalid transition
              }
            } else if (
              (currentStatus.includes("pickup") || currentStatus.includes("picked")) &&
              fulfillment.status === "label_created"
            ) {
              try {
                await transitionFulfillment(rt, ctx, fulfillment.id, {
                  type: "fulfillment.pick_up",
                  data: { awb, provider: "shiprocket" },
                }, tx);
              } catch {
                // Ignore invalid transition
              }
            }
          }
        });
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
