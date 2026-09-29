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
import { eq } from "drizzle-orm";

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
    // Missing Resend API key or provider credentials cannot be resolved by retry
    if (result.error?.includes("No Resend API key configured")) {
      log.warn(
        { template: input.template, toEmail: input.toEmail, error: result.error },
        "Transactional email skipped: missing Resend API key",
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
      .where(eq(schema.orders.id, orderId))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "order_rto",
      toEmail: orderRows[0].email,
      subject: `Update regarding order ${orderRows[0].number}: Return to Origin Initiated`,
      data: { orderNumber: orderRows[0].number, fulfillmentId },
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
      .where(eq(schema.orders.id, orderId))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "order_shipped",
      toEmail: orderRows[0].email,
      subject: `Your order ${orderRows[0].number} has shipped!`,
      data: { orderNumber: orderRows[0].number, awb, carrier },
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
      .where(eq(schema.orders.id, orderId))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "order_delivered",
      toEmail: orderRows[0].email,
      subject: `Your order ${orderRows[0].number} has been delivered`,
      data: { orderNumber: orderRows[0].number },
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
      .where(eq(schema.orders.id, orderId))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "return_requested",
      toEmail: orderRows[0].email,
      subject: `Return request received: ${returnNumber}`,
      data: { returnNumber, orderNumber: orderRows[0].number },
      eventRef: `return_${returnId}`,
    });
  }
}

export async function handleRefundProcessedJob(
  db: Db,
  log: Logger,
  data: { tenantId: string; orderId: string; refundAmount: number; refundId?: string },
): Promise<void> {
  const { tenantId, orderId, refundAmount, refundId } = data;
  const orderRows = await withTenant(db, tenantId, async (tx) => {
    return await tx
      .select({ email: schema.orders.email, number: schema.orders.number })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
  });

  if (orderRows[0]?.email) {
    await dispatchTransactionalEmailOrThrow(db, log, {
      tenantId,
      template: "refund_processed",
      toEmail: orderRows[0].email,
      subject: `Refund processed for order ${orderRows[0].number}`,
      data: { orderNumber: orderRows[0].number, refundAmount },
      eventRef: `refund_${orderId}_${refundId ?? "processed"}`,
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

export async function startJobs(opts: {
  databaseUrl: string;
  log: Logger;
  concurrency: number;
  db?: Db | undefined;
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

  // Handle webhook background processing (PLAN §11.4)
  await boss.work<{ inboxId: string }>(QUEUE_NAMES.WEBHOOK_PROCESS, { localConcurrency: 2 }, async (batch) => {
    for (const job of batch) {
      try {
        const res = await processWebhookInboxItem(db, job.data.inboxId);
        opts.log.info({ job_id: job.id, inboxId: job.data.inboxId, success: res.success }, "webhook.process completed");
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
        const res = await cleanupExpiredIdempotencyKeys(db, job.data?.tenantId);
        opts.log.info({ job_id: job.id, deletedCount: res.deletedCount }, "idempotency.cleanup processed");
      } catch (err) {
        opts.log.error({ err, job_id: job.id }, "idempotency.cleanup failed");
        throw err;
      }
    }
  });

  // Handle fulfillment.created domain event (send shipping notification)
  await boss.work<{ tenantId: string; fulfillmentId: string; orderId: string; awb?: string; carrier?: string }>(
    QUEUE_NAMES.FULFILLMENT_CREATED,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await handleFulfillmentShippedJob(db, opts.log, job.data);
          opts.log.info({ job_id: job.id, fulfillmentId: job.data.fulfillmentId }, "fulfillment.created processed");
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
          await handleFulfillmentDeliveredJob(db, opts.log, job.data);
          opts.log.info({ job_id: job.id, fulfillmentId: job.data.fulfillmentId }, "fulfillment.delivered processed");
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
          await handleFulfillmentRtoJob(db, opts.log, job.data);
          opts.log.info({ job_id: job.id, fulfillmentId: job.data.fulfillmentId }, "fulfillment.rto processed");
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
          await handleCartAbandonedJob(db, opts.log, job.data);
          opts.log.info({ job_id: job.id, cartId: job.data.cartId }, "cart.abandoned processed");
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
          await handleReturnRequestedJob(db, opts.log, job.data);
          opts.log.info({ job_id: job.id, returnId: job.data.returnId }, "return.requested processed");
        } catch (err) {
          opts.log.error({ err, job_id: job.id }, "return.requested failed");
          throw err;
        }
      }
    },
  );

  // Handle refund.processed domain event
  await boss.work<{ tenantId: string; orderId: string; refundAmount: number; refundId?: string }>(
    QUEUE_NAMES.REFUND_PROCESSED,
    { localConcurrency: 2 },
    async (batch) => {
      for (const job of batch) {
        try {
          await handleRefundProcessedJob(db, opts.log, job.data);
          opts.log.info({ job_id: job.id, orderId: job.data.orderId }, "refund.processed processed");
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
          const allTenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
          tenantIds = allTenants.map((t) => t.id);
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

  // Register recurring schedules and proof-of-life sweeps on boot (PLAN §5.10, §11.3)
  try {
    await boss.schedule(QUEUE_NAMES.RESERVATION_EXPIRY, "* * * * *", {});
    await boss.schedule(QUEUE_NAMES.IDEMPOTENCY_CLEANUP, "*/15 * * * *", {});
    await boss.schedule(QUEUE_NAMES.CART_RECOVERY_SWEEP, "0 * * * *", {});
    opts.log.info("Registered recurring cron: reservation.expiry (* * * * *), idempotency.cleanup (*/15 * * * *), cart.recovery_sweep (0 * * * *)");
  } catch (err) {
    opts.log.warn({ err }, "Could not register recurring cron schedules with pg-boss");
  }

  // Proof of life on boot: enqueue one ping and trigger initial maintenance passes
  await boss.send("system.ping", { at: new Date().toISOString() });
  await boss.send(QUEUE_NAMES.RESERVATION_EXPIRY, {});
  await boss.send(QUEUE_NAMES.IDEMPOTENCY_CLEANUP, {});
  await boss.send(QUEUE_NAMES.CART_RECOVERY_SWEEP, {});
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
