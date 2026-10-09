import { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { QUEUE_NAMES } from "@bs/db";
import { createDb, type Db, type DbHandle, withTenant } from "@bs/db";
import { expireOldReservations } from "./catalog/inventory-reservations.ts";
import { processWebhookInboxItem } from "./system/webhooks.ts";
import { cleanupExpiredIdempotencyKeys } from "./system/idempotency.ts";
import { sendTransactionalEmail } from "./system/email.ts";
import { sweepAbandonedCarts } from "./system/abandoned-carts.ts";
import { schema } from "@bs/db";
import { eq, and, notInArray } from "drizzle-orm";
import { acquireTenantJobSlot, cleanExpiredRateLimits, reapStaleTenantJobSlots, releaseTenantJobSlot } from "./system/rate-limit.ts";
import { runTrialExpirySweep } from "./saas/trial-expiry.ts";
import { isMarketingAllowed } from "./system/tenant-lifecycle.ts";
import { handleFinancePost, runFinanceReconcileSweep } from "./finance/index.ts";

/**
 * Job runtime (PLAN §11). Queues are created by the migrate step (as app_owner); workers run
 * as app_rw with migrate:false. Every consumer must be idempotent. From M1 domain services
 * enqueue inside their business transaction (transactional outbox).
 */
export interface Jobs {
  isRunning(): boolean;
  stop(): Promise<void>;
  send(queue: string, data: object): Promise<string | null>;
}

/**
 * Dispatches a transactional email and handles failures according to retry semantics.
 * If the error is genuinely un-retryable (e.g. missing API key or killswitch), logs clearly and does NOT throw.
 * Otherwise throws an Error so pg-boss will retry under the queue's exponential backoff policy.
 */
export async function dispatchTransactionalEmailOrThrow(
  db: Db,
  log: Logger,
  input: Parameters<typeof sendTransactionalEmail>[1],
): Promise<void> {
  const result = await sendTransactionalEmail(db, input);
  if (result.status === "failed") {
    // Missing email configuration or disabled service cannot be resolved by immediate retry
    if (
      result.error?.includes("Email service not configured") ||
      result.error?.includes("Email service disabled")
    ) {
      log.warn(
        { template: input.template, toEmail: input.toEmail, error: result.error },
        "Transactional email skipped: email service not configured or disabled",
      );
      return;
    }
    log.error(
      { template: input.template, toEmail: input.toEmail, error: result.error },
      "Transactional email failed, throwing for pg-boss retry",
    );
    throw new Error(`Transactional email [${input.template}] delivery failed: ${result.error}`);
  }
}

/** Sends the order confirmation once per order (a retried job finds the email already logged and stops). */
export async function handleOrderCreatedJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; orderId: string },
): Promise<void> {
  const { tenantId, orderId } = data;
  const [order] = await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select({ email: schema.orders.email, number: schema.orders.number })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)))
      .limit(1);
  });
  // The job is queued while the order is still being committed: if it is not visible yet, fail so pg-boss retries.
  if (!order) throw new Error(`Order ${orderId} not visible yet; retrying`);
  if (!order.email) return;

  const eventRef = `order_created_${orderId}`;
  const [alreadySent] = await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select({ id: schema.emailLog.id })
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.tenantId, tenantId), eq(schema.emailLog.eventRef, eventRef), eq(schema.emailLog.status, "sent")))
      .limit(1);
  });
  if (alreadySent) {
    log.info({ orderId, eventRef }, "Order confirmation already sent, skipping duplicate");
    return;
  }

  await dispatchTransactionalEmailOrThrow(db, log, {
    tenantId,
    template: "order_confirmation",
    toEmail: order.email,
    subject: `Order ${order.number} confirmed`,
    data: { orderId, orderNumber: order.number },
    eventRef,
  });

  // Staff new-order alert (Slice 7A, PLAN §3)
  try {
    const { readNotificationPreferences } = await import("./admin/notification-settings.ts");
    const prefs = await withTenant(db, tenantId, async (tx) => readNotificationPreferences(tx, tenantId));
    if (prefs.staff.newOrder.enabled && prefs.staff.newOrder.recipients.length > 0) {
      const [fullOrder] = await withTenant(db, tenantId, async (tx) => {
        return await tx
          .select({
            number: schema.orders.number,
            grandTotal: schema.orders.grandTotal,
            shippingAddress: schema.orders.shippingAddress,
          })
          .from(schema.orders)
          .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)))
          .limit(1);
      });

      const customerName = (fullOrder?.shippingAddress as Record<string, unknown> | null)?.fullName ?? "Customer";
      const grandTotal = fullOrder?.grandTotal ?? 0;

      for (const recipient of prefs.staff.newOrder.recipients) {
        const staffRef = `staff_order_${orderId}_${recipient.trim().toLowerCase()}`;
        const [alreadySentStaff] = await withTenant(db, tenantId, async (tx) => {
          return await tx
            .select({ id: schema.emailLog.id })
            .from(schema.emailLog)
            .where(and(eq(schema.emailLog.tenantId, tenantId), eq(schema.emailLog.eventRef, staffRef), eq(schema.emailLog.status, "sent")))
            .limit(1);
        });

        if (!alreadySentStaff) {
          await dispatchTransactionalEmailOrThrow(db, log, {
            tenantId,
            template: "staff_new_order",
            toEmail: recipient.trim(),
            subject: `New order ${order.number} received (${customerName})`,
            data: {
              order: { number: order.number, grandTotal, items: [], subtotal: 0, discountTotal: 0, shippingTotal: 0, codFee: 0, paymentStatus: "pending" },
              customerName: String(customerName),
              adminUrl: `/orders/${orderId}`,
            },
            eventRef: staffRef,
          }).catch((err) => {
            log.warn({ err, recipient, orderId }, "Staff new-order email alert failed");
          });
        }
      }
    }
  } catch (err) {
    log.warn({ err, orderId }, "Failed to process staff new order alerts");
  }
}

export async function handleFulfillmentRtoJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; fulfillmentId: string; orderId: string },
): Promise<void> {
  const { tenantId, fulfillmentId, orderId } = data;
  const orderRows = await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select({ email: schema.orders.email, number: schema.orders.number })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "order_rto",
      toEmail: orderRows[0].email,
      subject: `Update regarding order ${orderRows[0].number}: Return to Origin Initiated`,
      data: { orderId, orderNumber: orderRows[0].number, fulfillmentId },
      eventRef: `rto_${fulfillmentId}`,
    });
  }
}

export async function handleFulfillmentShippedJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; fulfillmentId: string; orderId: string; awb?: string; carrier?: string },
): Promise<void> {
  const { tenantId, orderId, awb, carrier, fulfillmentId } = data;
  const orderRows = await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select({ email: schema.orders.email, number: schema.orders.number })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "order_shipped",
      toEmail: orderRows[0].email,
      subject: `Your order ${orderRows[0].number} has shipped!`,
      data: { orderId, orderNumber: orderRows[0].number, awb, carrier },
      eventRef: `fulfillment_${fulfillmentId}`,
    });
  }
}

export async function handleFulfillmentDeliveredJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; fulfillmentId: string; orderId: string },
): Promise<void> {
  const { tenantId, orderId, fulfillmentId } = data;
  const orderRows = await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select({ email: schema.orders.email, number: schema.orders.number })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "order_delivered",
      toEmail: orderRows[0].email,
      subject: `Your order ${orderRows[0].number} has been delivered`,
      data: { orderId, orderNumber: orderRows[0].number },
      eventRef: `delivered_${fulfillmentId}`,
    });
  }
}

export async function handleReturnRequestedJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; returnId: string; orderId: string; returnNumber: string },
): Promise<void> {
  const { tenantId, orderId, returnNumber, returnId } = data;
  const orderRows = await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select({ email: schema.orders.email, number: schema.orders.number })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "return_requested",
      toEmail: orderRows[0].email,
      subject: `Return request received: ${returnNumber}`,
      data: { orderId, returnNumber, orderNumber: orderRows[0].number },
      eventRef: `return_${returnId}`,
    });
  }
}

export async function handleRefundProcessedJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; orderId: string; refundAmount?: number; refundId?: string; returnId?: string },
): Promise<void> {
  const { tenantId, orderId, refundAmount = 0, refundId, returnId } = data;
  const refundKey = refundId ?? returnId;
  const orderRows = await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select({ email: schema.orders.email, number: schema.orders.number })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.id, orderId)))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    const refundRef = `refund_${orderId}_${refundKey ?? "processed"}`;

    // Deduplicate per-refund: if an email was already successfully logged for this refund, skip sending again
    const [alreadySent] = await withTenant(db, tenantId, async (tx) => {
      return await tx
        .select({ id: schema.emailLog.id })
        .from(schema.emailLog)
        .where(
          and(
            eq(schema.emailLog.tenantId, tenantId),
            eq(schema.emailLog.eventRef, refundRef),
            eq(schema.emailLog.status, "sent"),
          ),
        )
        .limit(1);
    });

    if (alreadySent) {
      log.info({ orderId, refundKey, eventRef: refundRef }, "Refund email already sent, skipping duplicate");
      return;
    }

    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "refund_processed",
      toEmail: orderRows[0].email,
      subject: `Refund processed for order ${orderRows[0].number}`,
      data: { orderId, orderNumber: orderRows[0].number, refundAmount },
      eventRef: refundRef,
    });
  }
}

export async function handleCartAbandonedJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; cartId: string; token: string; email?: string },
): Promise<void> {
  const { tenantId, cartId, token, email } = data;
  if (email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "abandoned_cart_recovery",
      toEmail: email,
      subject: "Did you leave something behind?",
      data: { cartToken: token },
      eventRef: `cart_abandoned_${cartId}`,
    });
  }
}

export async function handleOrderPreorderDateChangedJob(
  db: Db,
  log: Logger,
  data: {
    tenantId: string;
    orderId: string;
    orderNumber: string;
    email: string;
    shipsOn: string;
    reason?: string | null;
  },
): Promise<void> {
  const { tenantId, orderId, orderNumber, email, shipsOn, reason } = data;
  if (!email) return;

  const eventRef = `order_preorder_date_changed_${orderId}_${shipsOn}`;
  const [alreadySent] = await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select({ id: schema.emailLog.id })
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.tenantId, tenantId), eq(schema.emailLog.eventRef, eventRef), eq(schema.emailLog.status, "sent")))
      .limit(1);
  });
  if (alreadySent) {
    log.info({ orderId, eventRef }, "Pre-order date changed email already sent, skipping duplicate");
    return;
  }

  await dispatchTransactionalEmailOrThrow(db, log, {
    tenantId,
    template: "order_preorder_date_changed",
    toEmail: email,
    subject: `Update on your order ${orderNumber}: New estimated dispatch date`,
    data: {
      orderId,
      orderNumber,
      shipsOn,
      reason: reason ?? null,
    },
    eventRef,
  });
}

export async function runPreorderReminderSweep(
  db: Db,
  log?: Logger,
  tenantId?: string,
): Promise<{ remindersSent: number }> {
  // 2 days before promised ship date: target date is today + 2 days
  const targetDateObj = new Date();
  targetDateObj.setDate(targetDateObj.getDate() + 2);
  const targetDate = targetDateObj.toISOString().slice(0, 10);

  const tenants = tenantId
    ? [{ id: tenantId }]
    : await db.select({ id: schema.tenants.id }).from(schema.tenants);

  let remindersSent = 0;

  for (const t of tenants) {
    await withTenant(db, t.id, async (tx) => {
      const orders = await tx
        .select({
          id: schema.orders.id,
          number: schema.orders.number,
          email: schema.orders.email,
          shipsOn: schema.orders.shipsOn,
          status: schema.orders.status,
        })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.tenantId, t.id),
            eq(schema.orders.shipsOn, targetDate),
            notInArray(schema.orders.status, ["shipped", "delivered", "cancelled"]),
          ),
        );

      for (const order of orders) {
        // Idempotency: skip if reminder was already recorded
        const [existingEvent] = await tx
          .select({ id: schema.orderEvents.id })
          .from(schema.orderEvents)
          .where(
            and(
              eq(schema.orderEvents.tenantId, t.id),
              eq(schema.orderEvents.orderId, order.id),
              eq(schema.orderEvents.type, "order.preorder_reminder_sent"),
            ),
          )
          .limit(1);

        if (existingEvent) {
          continue;
        }

        // Record order event for timeline and idempotency
        await tx.insert(schema.orderEvents).values({
          tenantId: t.id,
          orderId: order.id,
          type: "order.preorder_reminder_sent",
          actorType: "system",
          actorId: "system",
          message: `2-day pre-order reminder: promised dispatch date is ${order.shipsOn}.`,
          data: { shipsOn: order.shipsOn },
          visibleToCustomer: true,
        });

        remindersSent++;

        if (order.email) {
          const eventRef = `preorder_reminder_${order.id}_${order.shipsOn}`;
          const fallbackLog = log ?? ({ warn: () => {}, info: () => {}, error: () => {} } as unknown as Logger);
          await dispatchTransactionalEmailOrThrow(db, fallbackLog, {
            tenantId: t.id,
            template: "order_preorder_reminder",
            toEmail: order.email,
            subject: `Your pre-order ${order.number} ships soon`,
            data: {
              orderId: order.id,
              orderNumber: order.number,
              shipsOn: order.shipsOn,
            },
            eventRef,
          }).catch((err) => {
            log?.warn({ err, orderId: order.id }, "Failed to send preorder reminder email");
          });
        }
      }
    });
  }

  return { remindersSent };
}

// Handle customer metrics recalculation (PLAN §0a)
export async function handleCustomerRefreshMetricsJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; customerId: string },
): Promise<void> {
  const { tenantId, customerId } = data;
  const { refreshCustomerMetrics } = await import("./customers/metrics.ts");
  const res = await refreshCustomerMetrics(db, tenantId, customerId);
  if (!res) {
    log.warn({ tenantId, customerId }, "Customer not found for metrics refresh; skipping");
    return;
  }
  log.info({ tenantId, customerId, ordersCount: res.ordersCount, totalSpent: res.totalSpent }, "Customer metrics refreshed");
}

// Refresh cached segment member counts (Customers Segments PLAN §4); scheduled every 6 hours.
export async function handleSegmentRefreshCountsJob(db: Db, log: Logger, data: { tenantId?: string }): Promise<void> {
  const { refreshAllSegmentCounts } = await import("./segments/service.ts");
  const res = await refreshAllSegmentCounts(db, data.tenantId);
  log.info({ processed: res.processed, tenantId: data.tenantId ?? "all" }, "segments.refresh_counts processed");
}

// Handle the CSV customer import for large files (Customers Phase 1, step 1C)
export async function handleCustomerImportJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; rows: { name?: string; email: string; phone?: string; tags?: string[]; marketingConsent?: string }[]; actorId: string | null },
): Promise<void> {
  const { commitImportRows } = await import("./customers/import.ts");
  const res = await commitImportRows(db, data.tenantId, { type: "staff", userId: data.actorId }, data.rows);
  log.info({ tenantId: data.tenantId, created: res.created, updated: res.updated, failed: res.errors.length }, "customers.import processed");
}

export async function handleMaintenanceStartJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; startsAt?: string; endsAt?: string },
): Promise<void> {
  const { tenantId } = data;
  await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, tenantId))
      .limit(1);

    if (!row) return;
    if (row.mode === "maintenance") {
      log.info({ tenantId }, "maintenance.start: store already in maintenance mode");
      return;
    }

    const currentMode = row.mode;
    const now = new Date();

    await tx
      .update(schema.storeStatus)
      .set({
        mode: "maintenance",
        modeBeforeMaintenance: currentMode,
        changedAt: now,
        changedBy: null,
      })
      .where(eq(schema.storeStatus.id, row.id));

    await tx.insert(schema.storeStatusTransitions).values({
      tenantId,
      fromMode: currentMode,
      toMode: "maintenance",
      reason: "scheduled_start",
      actorType: "system",
      actorId: null,
      at: now,
    });

    await tx.insert(schema.auditLogs).values({
      tenantId,
      actorType: "system",
      actorId: null,
      action: "store_status.scheduled_start",
      targetType: "store_status",
      targetId: row.id,
      diff: {
        mode: { before: currentMode, after: "maintenance" },
        reason: { before: null, after: "scheduled_start" },
      },
    });
  });
}

export async function handleMaintenanceEndJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; endsAt?: string },
): Promise<void> {
  const { tenantId } = data;
  await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, tenantId))
      .limit(1);

    if (!row) return;
    const now = new Date();

    if (row.mode !== "maintenance") {
      log.info({ tenantId, mode: row.mode }, "maintenance.end: mode already changed manually during window");
      await tx
        .update(schema.storeStatus)
        .set({
          maintenanceStartsAt: null,
          maintenanceEndsAt: null,
          modeBeforeMaintenance: null,
          changedAt: now,
          changedBy: null,
        })
        .where(eq(schema.storeStatus.id, row.id));
      return;
    }

    const restoreMode = row.modeBeforeMaintenance || "live";
    await tx
      .update(schema.storeStatus)
      .set({
        mode: restoreMode,
        maintenanceStartsAt: null,
        maintenanceEndsAt: null,
        modeBeforeMaintenance: null,
        changedAt: now,
        changedBy: null,
      })
      .where(eq(schema.storeStatus.id, row.id));

    await tx.insert(schema.storeStatusTransitions).values({
      tenantId,
      fromMode: "maintenance",
      toMode: restoreMode,
      reason: "scheduled_end",
      actorType: "system",
      actorId: null,
      at: now,
    });

    await tx.insert(schema.auditLogs).values({
      tenantId,
      actorType: "system",
      actorId: null,
      action: "store_status.scheduled_end",
      targetType: "store_status",
      targetId: row.id,
      diff: {
        mode: { before: "maintenance", after: restoreMode },
        reason: { before: null, after: "scheduled_end" },
      },
    });
  });
}

export async function handleMaintenanceCleanupJob(
  db: Db,
  log: Logger,
  data?: { tenantId?: string },
): Promise<{
  deletedCount: number;
  prunedCounters: number;
  reapedSlots: number;
  prunedEmailLogs: number;
  prunedMessageLogs: number;
  prunedTenantEmailLogs: number;
  prunedReqs: number;
}> {
  const res = await cleanupExpiredIdempotencyKeys(db, data?.tenantId);
  // Same 15-minute maintenance pass: prune expired rate-limit counters, free job slots that a
  // crashed worker never released, and prune platform_email_log and platform_message_log older than 90 days (PLAN §3.1, §6.2).
  const prunedCounters = await cleanExpiredRateLimits(db);
  const reapedSlots = await reapStaleTenantJobSlots(db);
  const { prunePlatformEmailLogs } = await import("./system/platform-mailer.ts");
  const prunedEmailLogs = await prunePlatformEmailLogs(db, 90).catch((err) => {
    log.warn({ err }, "platform_email_log prune failed during maintenance pass");
    return { deletedCount: 0 };
  });
  const { prunePlatformMessageLogs } = await import("./platform/channel-providers.ts");
  const prunedMessageLogs = await prunePlatformMessageLogs(db, 90).catch((err) => {
    log.warn({ err }, "platform_message_log prune failed during maintenance pass");
    return { deletedCount: 0 };
  });
  const { pruneEmailLogs, prunePrivacyRequests } = await import("./system/retention.ts");
  const prunedTenantEmailLogs = await pruneEmailLogs(db, 180).catch((err) => {
    log.warn({ err }, "email_log prune failed during maintenance pass");
    return { deletedCount: 0 };
  });
  const prunedReqs = await prunePrivacyRequests(db, 1095).catch((err) => {
    log.warn({ err }, "privacy_requests prune failed during maintenance pass");
    return { deletedCount: 0 };
  });

  return {
    deletedCount: res.deletedCount,
    prunedCounters,
    reapedSlots,
    prunedEmailLogs: prunedEmailLogs.deletedCount,
    prunedMessageLogs: prunedMessageLogs.deletedCount,
    prunedTenantEmailLogs: prunedTenantEmailLogs.deletedCount,
    prunedReqs: prunedReqs.deletedCount,
  };
}

export async function startJobs(opts: {
  databaseUrl: string;
  log: Logger;
  concurrency: number;
  db?: Db | undefined;
  /** app_saas connection for the trial sweep; without it the sweep is skipped with a warning. */
  saasDb?: Db | undefined;
}): Promise<Jobs> {
  const boss = new PgBoss({ connectionString: opts.databaseUrl, max: 3, migrate: false, application_name: "bsec-worker" });
  let running = false;
  boss.on("error", (err) => opts.log.error({ err }, "pg-boss error"));
  await boss.start();
  running = true;

  let localDbHandle: DbHandle | undefined;
  const db = opts.db ?? (() => {
    localDbHandle = createDb(opts.databaseUrl, { max: 2, applicationName: "bsec-worker-jobs" });
    return localDbHandle.db;
  })();

  await boss.work<{ at: string }>("system.ping", { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) opts.log.info({ job_id: job.id, at: job.data.at }, "system.ping");
  });

  // Handle inventory reservation expiration (PLAN §11.3)
  await boss.work<{ tenantId?: string }>(QUEUE_NAMES.RESERVATION_EXPIRY, { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) {
      try {
        const res = await expireOldReservations(db, job.data?.tenantId);
        opts.log.info({ job_id: job.id, expiredCount: res.expiredCount }, "reservation.expiry processed");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "reservation.expiry failed");
        throw err;
      }
    }
  });

  const withTenantJobSlot = async <T>(
    tenantId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> => {
    if (!tenantId) {
      return fn();
    }
    const acquired = await acquireTenantJobSlot(db, tenantId);
    if (!acquired) {
      opts.log.warn({ tenantId }, "Tenant job concurrency ceiling reached; deferring job for retry");
      throw new Error(`Tenant job concurrency limit reached for tenant ${tenantId}`);
    }
    try {
      return await fn();
    } finally {
      await releaseTenantJobSlot(db, tenantId);
    }
  };

  // Handle webhook background processing (PLAN §11.4)
  await boss.work<{ inboxId: string; tenantId?: string }>(QUEUE_NAMES.WEBHOOK_PROCESS, { localConcurrency: 2 }, async (batch) => {
    for (const job of batch) {
      try {
        await withTenantJobSlot(job.data?.tenantId, async () => {
          const res = await processWebhookInboxItem(db, job.data.inboxId);
          opts.log.info({ job_id: job.id, inboxId: job.data.inboxId, success: res.success }, "webhook.process completed");
        });
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "webhook.process failed");
        throw err;
      }
    }
  });

  // Handle idempotency keys cleanup (PLAN §5.10)
  await boss.work<{ tenantId?: string }>(QUEUE_NAMES.IDEMPOTENCY_CLEANUP, { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) {
      try {
        const stats = await handleMaintenanceCleanupJob(db, opts.log, job.data);
        opts.log.info(
          {
            job_id: job.id,
            ...stats,
          },
          "idempotency.cleanup processed",
        );
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "idempotency.cleanup failed");
        throw err;
      }
    }
  });

  // Handle order.created domain event (send the order confirmation)
  await boss.work<{ tenantId: string; orderId: string }>(
    QUEUE_NAMES.ORDER_CREATED,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await handleOrderCreatedJob(db, opts.log, job.data);
            opts.log.info({ job_id: job.id, orderId: job.data.orderId }, "order.created processed");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "order.created failed");
          throw err;
        }
      }
    },
  );

  // Handle fulfillment.created domain event (send shipping notification)
  await boss.work<{ tenantId: string; fulfillmentId: string; orderId: string; awb?: string; carrier?: string }>(
    QUEUE_NAMES.FULFILLMENT_CREATED,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await handleFulfillmentShippedJob(db, opts.log, job.data);
            opts.log.info({ job_id: job.id, fulfillmentId: job.data.fulfillmentId }, "fulfillment.created processed");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "fulfillment.created failed");
          throw err;
        }
      }
    },
  );

  // Handle fulfillment.delivered domain event
  await boss.work<{ tenantId: string; fulfillmentId: string; orderId: string }>(
    QUEUE_NAMES.FULFILLMENT_DELIVERED,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await handleFulfillmentDeliveredJob(db, opts.log, job.data);
            opts.log.info({ job_id: job.id, fulfillmentId: job.data.fulfillmentId }, "fulfillment.delivered processed");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "fulfillment.delivered failed");
          throw err;
        }
      }
    },
  );

  // Handle fulfillment.rto domain event (PLAN §11.1 / M5)
  await boss.work<{ tenantId: string; fulfillmentId: string; orderId: string }>(
    QUEUE_NAMES.FULFILLMENT_RTO,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await handleFulfillmentRtoJob(db, opts.log, job.data);
            opts.log.info({ job_id: job.id, fulfillmentId: job.data.fulfillmentId }, "fulfillment.rto processed");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "fulfillment.rto failed");
          throw err;
        }
      }
    },
  );

  // Handle cart.abandoned domain event (PLAN §5.5, §11 / M5)
  await boss.work<{ tenantId: string; cartId: string; token: string; email?: string }>(
    QUEUE_NAMES.CART_ABANDONED,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await handleCartAbandonedJob(db, opts.log, job.data);
            opts.log.info({ job_id: job.id, cartId: job.data.cartId }, "cart.abandoned processed");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "cart.abandoned failed");
          throw err;
        }
      }
    },
  );

  // Handle return.requested domain event
  await boss.work<{ tenantId: string; returnId: string; orderId: string; returnNumber: string }>(
    QUEUE_NAMES.RETURN_REQUESTED,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await handleReturnRequestedJob(db, opts.log, job.data);
            opts.log.info({ job_id: job.id, returnId: job.data.returnId }, "return.requested processed");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "return.requested failed");
          throw err;
        }
      }
    },
  );

  // Handle refund.processed domain event
  await boss.work<{ tenantId: string; orderId: string; refundAmount?: number; refundId?: string; returnId?: string }>(
    QUEUE_NAMES.REFUND_PROCESSED,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await handleRefundProcessedJob(db, opts.log, job.data);
            opts.log.info({ job_id: job.id, orderId: job.data.orderId }, "refund.processed processed");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "refund.processed failed");
          throw err;
        }
      }
    },
  );

  // Handle cart.recovery_sweep recurring job
  await boss.work<{ tenantId?: string }>(QUEUE_NAMES.CART_RECOVERY_SWEEP, { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) {
      try {
        let tenantIds: string[] = [];
        if (job.data?.tenantId) {
          tenantIds = [job.data.tenantId];
        } else {
          // Marketing (recovery e-mails) is paused for stores that are not live (suspended, archived, being deleted)
          const allTenants = await db.select({ id: schema.tenants.id, status: schema.tenants.status }).from(schema.tenants);
          tenantIds = allTenants.filter((t) => isMarketingAllowed(t.status)).map((t) => t.id);
        }

        let totalAbandoned = 0;
        let totalEmails = 0;
        for (const tId of tenantIds) {
          const res = await sweepAbandonedCarts(db, tId, { jobs: boss, log: opts.log });
          totalAbandoned += res.abandonedCount;
          totalEmails += res.emailsSentCount;
        }
        opts.log.info({ job_id: job.id, totalAbandoned, totalEmails }, "cart.recovery_sweep processed");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "cart.recovery_sweep failed");
        throw err;
      }
    }
  });

  // Handle subscription trial expiry sweep (PLAN §6.4, §14)
  await boss.work(QUEUE_NAMES.SUBSCRIPTION_TRIAL_EXPIRY_SWEEP, { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) {
      try {
        if (!opts.saasDb) {
          opts.log.warn({ job_id: job.id }, "subscription.trial_expiry_sweep skipped: DATABASE_URL_SAAS not configured");
          continue;
        }
        const res = await runTrialExpirySweep(opts.saasDb);
        opts.log.info({ job_id: job.id, expiredCount: res.expired }, "subscription.trial_expiry_sweep processed");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "subscription.trial_expiry_sweep failed");
        throw err;
      }
    }
  });

  // Handle order.preorder_date_changed event
  await boss.work<{
    tenantId: string;
    orderId: string;
    orderNumber: string;
    email: string;
    shipsOn: string;
    reason?: string | null;
  }>(QUEUE_NAMES.ORDER_PREORDER_DATE_CHANGED, { localConcurrency: 2 }, async (batch) => {
    for (const job of batch) {
      try {
        await withTenantJobSlot(job.data.tenantId, async () => {
          await handleOrderPreorderDateChangedJob(db, opts.log, job.data);
          opts.log.info({ job_id: job.id, orderId: job.data.orderId }, "order.preorder_date_changed processed");
        });
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "order.preorder_date_changed failed");
        throw err;
      }
    }
  });

  // Handle order.preorder_reminder_sweep recurring job
  await boss.work<{ tenantId?: string }>(QUEUE_NAMES.ORDER_PREORDER_REMINDER_SWEEP, { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) {
      try {
        const res = await runPreorderReminderSweep(db, opts.log, job.data?.tenantId);
        opts.log.info({ job_id: job.id, remindersSent: res.remindersSent }, "order.preorder_reminder_sweep processed");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "order.preorder_reminder_sweep failed");
        throw err;
      }
    }
  });

  // Handle order.return_photo_cleanup recurring / triggered cleanup
  await boss.work<{ tenantId?: string }>(QUEUE_NAMES.ORDER_RETURN_PHOTO_CLEANUP, { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) {
      try {
        const { cleanupOrphanedReturnPhotos } = await import("./orders/return-photos.ts");
        const res = await cleanupOrphanedReturnPhotos(db);
        opts.log.info({ job_id: job.id, deletedCount: res.deletedCount }, "order.return_photo_cleanup processed");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "order.return_photo_cleanup failed");
        throw err;
      }
    }
  });

  // Handle customers.refresh_metrics domain event (PLAN §0a)
  await boss.work<{ tenantId: string; customerId: string }>(
    QUEUE_NAMES.CUSTOMERS_REFRESH_METRICS,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await handleCustomerRefreshMetricsJob(db, opts.log, job.data);
            opts.log.info({ job_id: job.id, customerId: job.data.customerId }, "customers.refresh_metrics processed");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "customers.refresh_metrics failed");
          throw err;
        }
      }
    },
  );

  // Handle segments.refresh_counts (Customers Segments PLAN §4): recurring every 6 hours.
  await boss.work<{ tenantId?: string }>(QUEUE_NAMES.SEGMENTS_REFRESH_COUNTS, { localConcurrency: 1 }, async (batch) => {
    for (const job of batch) {
      try {
        await handleSegmentRefreshCountsJob(db, opts.log, job.data ?? {});
        opts.log.info({ job_id: job.id }, "segments.refresh_counts dispatched");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "segments.refresh_counts failed");
        throw err;
      }
    }
  });
  // Handle customers.import domain event (Customers Phase 1, step 1C)
  await boss.work<{ tenantId: string; rows: { name?: string; email: string; phone?: string; tags?: string[]; marketingConsent?: string }[]; actorId: string | null }>(
    QUEUE_NAMES.CUSTOMERS_IMPORT,
    { localConcurrency: 1 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await handleCustomerImportJob(db, opts.log, job.data);
            opts.log.info({ job_id: job.id }, "customers.import dispatched");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "customers.import failed");
          throw err;
        }
      }
    },
  );

  // Handle finance.post job (docs/FINANCE-PLAN.md §3.3, §3.5)
  await boss.work<{ tenantId: string; kind: string; id: string }>(
    QUEUE_NAMES.FINANCE_POST,
    { localConcurrency: 4 },
    async (batch) => {
      for (const job of batch) {
        try {
          await withTenantJobSlot(job.data.tenantId, async () => {
            await withTenant(db, job.data.tenantId, async (tx) => {
              await handleFinancePost(tx, job.data.tenantId, job.data);
            });
            opts.log.info({ job_id: job.id, kind: job.data.kind, id: job.data.id }, "finance.post processed");
          });
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "finance.post failed");
          // Fire-and-forget: log and continue
        }
      }
    },
  );

  // Handle maintenance.start (Settings Phase 8 / Slice 8B)
  await boss.work<{ tenantId: string; startsAt?: string; endsAt?: string }>(
    QUEUE_NAMES.MAINTENANCE_START,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await handleMaintenanceStartJob(db, opts.log, job.data);
          opts.log.info({ job_id: job.id, tenantId: job.data.tenantId }, "maintenance.start processed");
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "maintenance.start failed");
          throw err;
        }
      }
    },
  );

  // Handle maintenance.end (Settings Phase 8 / Slice 8B)
  await boss.work<{ tenantId: string; endsAt?: string }>(
    QUEUE_NAMES.MAINTENANCE_END,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await handleMaintenanceEndJob(db, opts.log, job.data);
          opts.log.info({ job_id: job.id, tenantId: job.data.tenantId }, "maintenance.end processed");
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "maintenance.end failed");
          throw err;
        }
      }
    },
  );

  // Handle maintenance.watchdog_sweep recurring job (Settings Phase 8 / Slice 8B)
  await boss.work(
    QUEUE_NAMES.MAINTENANCE_WATCHDOG_SWEEP,
    { localConcurrency: 1 },
    async (batch) => {
      for (const job of batch) {
        try {
          const { executeMaintenanceWatchdogSweep } = await import("./storefront/lifecycle.ts");
          const res = await executeMaintenanceWatchdogSweep(db);
          opts.log.info({ job_id: job.id, ...res }, "maintenance.watchdog_sweep processed");
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "maintenance.watchdog_sweep failed");
          throw err;
        }
      }
    },
  );

  // Handle finance.reconcile recurring sweep (docs/FINANCE-PLAN.md §3.5)
  await boss.work(
    QUEUE_NAMES.FINANCE_RECONCILE,
    { localConcurrency: 1 },
    async (batch) => {
      for (const job of batch) {
        try {
          const res = await runFinanceReconcileSweep(db, opts.log);
          opts.log.info({ job_id: job.id, ...res }, "finance.reconcile sweep finished");
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "finance.reconcile sweep failed");
          throw err;
        }
      }
    },
  );

  // Register recurring schedules and proof-of-life sweeps on boot (PLAN §5.10, §11.3)
  try {
    await boss.schedule(QUEUE_NAMES.RESERVATION_EXPIRY, "* * * * *", {});
    await boss.schedule(QUEUE_NAMES.IDEMPOTENCY_CLEANUP, "*/15 * * * *", {});
    await boss.schedule(QUEUE_NAMES.CART_RECOVERY_SWEEP, "0 * * * *", {});
    await boss.schedule(QUEUE_NAMES.SUBSCRIPTION_TRIAL_EXPIRY_SWEEP, "0 * * * *", {});
    await boss.schedule(QUEUE_NAMES.ORDER_PREORDER_REMINDER_SWEEP, "0 6 * * *", {});
    await boss.schedule(QUEUE_NAMES.ORDER_RETURN_PHOTO_CLEANUP, "0 3 * * *", {});
    await boss.schedule(QUEUE_NAMES.SEGMENTS_REFRESH_COUNTS, "0 */6 * * *", {});
    await boss.schedule(QUEUE_NAMES.MAINTENANCE_WATCHDOG_SWEEP, "* * * * *", {});
    await boss.schedule(QUEUE_NAMES.FINANCE_RECONCILE, "0 4 * * *", {});
    opts.log.info("Registered recurring cron: reservation.expiry, idempotency.cleanup, cart.recovery_sweep, subscription.trial_expiry_sweep, preorder_reminder_sweep, return_photo_cleanup, maintenance.watchdog_sweep, finance.reconcile");
  } catch (err) {
    opts.log.warn({ err }, "Could not register recurring cron schedules with pg-boss");
  }

  // A restart (every deploy) kills any job that was running, so any slot still held now is leaked.
  // Single worker instance today; revisit if workers are ever scaled out.
  try {
    const freed = await reapStaleTenantJobSlots(db, 0);
    if (freed > 0) opts.log.warn({ freed }, "released job slots left over from the previous worker");
  } catch (err) {
    opts.log.warn({ err }, "could not release leftover job slots on boot");
  }

  // Proof of life on boot: enqueue one ping and trigger initial maintenance passes
  await boss.send("system.ping", { at: new Date().toISOString() });
  await boss.send(QUEUE_NAMES.RESERVATION_EXPIRY, {});
  await boss.send(QUEUE_NAMES.IDEMPOTENCY_CLEANUP, {});
  await boss.send(QUEUE_NAMES.CART_RECOVERY_SWEEP, {});
  await boss.send(QUEUE_NAMES.SUBSCRIPTION_TRIAL_EXPIRY_SWEEP, {});
  await boss.send(QUEUE_NAMES.MAINTENANCE_WATCHDOG_SWEEP, {});
  opts.log.info({ concurrency: opts.concurrency }, "worker started");

  return {
    isRunning: () => running,
    send: (queue, data) => boss.send(queue, data),
    stop: async () => {
      running = false;
      await boss.stop({ graceful: true, timeout: 20_000 });
      if (localDbHandle) {
        await localDbHandle.close();
      }
    },
  };
}
