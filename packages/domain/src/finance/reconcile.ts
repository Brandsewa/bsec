import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { handleFinancePost } from "./post-events.ts";
import { runRecurringExpenses } from "./expenses.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_SLICE_DAYS = 30;
const SWEEP_SLICES = 30;
const PAGE_LIMIT = 2000;

export interface ReconcileResult {
  written: number;
  scanned: {
    orders: number;
    refunds: number;
    restocks: number;
    expenses: number;
  };
  stoppedEarly: boolean;
}

/**
 * Calculates the rotating 30-day window for the deep sweep pass.
 * Deterministic from current date: repeats every 30 days.
 */
export function deepSweepWindow(now: Date = new Date()): {
  since: Date;
  until: Date;
} {
  const slice = Math.floor(now.getTime() / DAY_MS) % SWEEP_SLICES;
  const until = new Date(now.getTime() - slice * SWEEP_SLICE_DAYS * DAY_MS);
  return {
    since: new Date(until.getTime() - SWEEP_SLICE_DAYS * DAY_MS),
    until,
  };
}

export interface ReconcileOptions {
  now?: Date;
  timeBudgetMs?: number;
  fullBackfill?: boolean;
}

/**
 * Reconciles finance records for a single tenant under tenant RLS context.
 */
export async function reconcileTenant(
  db: Db,
  tenantId: string,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const now = options.now ?? new Date();
  const timeBudgetMs = options.timeBudgetMs ?? 45_000;
  const startTime = Date.now();

  let written = 0;
  let scannedOrders = 0;
  let scannedRefunds = 0;
  let scannedRestocks = 0;
  const scannedExpenses = 0;
  let stoppedEarly = false;

  const isBudgetExceeded = () => Date.now() - startTime >= timeBudgetMs;

  await withTenant(db, tenantId, async (tx) => {
    // 1. Materialize due recurring expenses (Phase 3)
    const recurringCount = await runRecurringExpenses(tx, tenantId, now);
    written += recurringCount;

    // 2. Define scan windows
    // Recent window: past 3 days
    const recentSince = new Date(now.getTime() - 3 * DAY_MS);
    const deep = deepSweepWindow(now);

    // Target order status
    const paidStatuses = ["paid", "cod_collected"];

    // A. Replay recent orders + deep slice orders
    const orderWindows = options.fullBackfill
      ? [{ since: new Date(0), until: now }]
      : [
          { since: recentSince, until: now },
          { since: deep.since, until: deep.until },
        ];

    for (const win of orderWindows) {
      if (isBudgetExceeded()) {
        stoppedEarly = true;
        break;
      }

      const ordersToReplay = await tx
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.tenantId, tenantId),
            inArray(schema.orders.paymentStatus, paidStatuses),
            gte(schema.orders.updatedAt, win.since),
            lte(schema.orders.updatedAt, win.until),
          ),
        )
        .orderBy(desc(schema.orders.updatedAt))
        .limit(PAGE_LIMIT);

      for (const ord of ordersToReplay) {
        if (isBudgetExceeded()) {
          stoppedEarly = true;
          break;
        }
        scannedOrders++;
        const count = await handleFinancePost(tx, tenantId, {
          kind: "order",
          id: ord.id,
        });
        written += count;
      }
    }

    // B. Replay refunds
    if (!stoppedEarly) {
      for (const win of orderWindows) {
        if (isBudgetExceeded()) {
          stoppedEarly = true;
          break;
        }

        const refundsToReplay = await tx
          .select({ id: schema.refunds.id })
          .from(schema.refunds)
          .where(
            and(
              eq(schema.refunds.tenantId, tenantId),
              eq(schema.refunds.status, "succeeded"),
              gte(schema.refunds.createdAt, win.since),
              lte(schema.refunds.createdAt, win.until),
            ),
          )
          .orderBy(desc(schema.refunds.createdAt))
          .limit(PAGE_LIMIT);

        for (const ref of refundsToReplay) {
          if (isBudgetExceeded()) {
            stoppedEarly = true;
            break;
          }
          scannedRefunds++;
          const count = await handleFinancePost(tx, tenantId, {
            kind: "refund",
            id: ref.id,
          });
          written += count;
        }
      }
    }

    // C. Replay restocks
    if (!stoppedEarly) {
      for (const win of orderWindows) {
        if (isBudgetExceeded()) {
          stoppedEarly = true;
          break;
        }

        const restocksToReplay = await tx
          .select({ id: schema.returns.id })
          .from(schema.returns)
          .where(
            and(
              eq(schema.returns.tenantId, tenantId),
              inArray(schema.returns.status, ["received", "refunded", "replaced", "closed"]),
              gte(schema.returns.updatedAt, win.since),
              lte(schema.returns.updatedAt, win.until),
            ),
          )
          .orderBy(desc(schema.returns.updatedAt))
          .limit(PAGE_LIMIT);

        for (const ret of restocksToReplay) {
          if (isBudgetExceeded()) {
            stoppedEarly = true;
            break;
          }
          scannedRestocks++;
          const count = await handleFinancePost(tx, tenantId, {
            kind: "restock",
            id: ret.id,
          });
          written += count;
        }

        // Orders cancelled in the window: the same idempotent cost-back as the live cancel path.
        const cancelledToReplay = await tx
          .select({ id: schema.orders.id })
          .from(schema.orders)
          .where(
            and(
              eq(schema.orders.tenantId, tenantId),
              eq(schema.orders.status, "cancelled"),
              gte(schema.orders.updatedAt, win.since),
              lte(schema.orders.updatedAt, win.until),
            ),
          )
          .orderBy(desc(schema.orders.updatedAt))
          .limit(PAGE_LIMIT);
        for (const ord of cancelledToReplay) {
          if (isBudgetExceeded()) {
            stoppedEarly = true;
            break;
          }
          scannedRestocks++;
          written += await handleFinancePost(tx, tenantId, { kind: "cancel_restock", id: ord.id });
        }
      }
    }
  });

  return {
    written,
    scanned: {
      orders: scannedOrders,
      refunds: scannedRefunds,
      restocks: scannedRestocks,
      expenses: scannedExpenses,
    },
    stoppedEarly,
  };
}

/**
 * Iterates through all active tenants under their respective RLS contexts
 * and runs finance reconciliation.
 */
export async function runFinanceReconcileSweep(
  db: Db,
  log: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void },
  options: ReconcileOptions = {},
): Promise<{ totalWritten: number; tenantsProcessed: number }> {
  const tenants = await db
    .select({ id: schema.tenants.id, status: schema.tenants.status })
    .from(schema.tenants);

  // Only reconcile active or live stores
  const activeTenants = tenants.filter((t) => t.status === "active");
  let totalWritten = 0;
  let tenantsProcessed = 0;

  for (const tenant of activeTenants) {
    try {
      const res = await reconcileTenant(db, tenant.id, options);
      totalWritten += res.written;
      tenantsProcessed++;

      if (res.written > 0) {
        log.warn(
          {
            tenantId: tenant.id,
            written: res.written,
            scanned: res.scanned,
            stoppedEarly: res.stoppedEarly,
          },
          "Finance reconcile healed missing ledger entries",
        );
      } else {
        log.info(
          {
            tenantId: tenant.id,
            scanned: res.scanned,
          },
          "Finance reconcile completed with healthy ledger",
        );
      }
    } catch (err) {
      log.warn({ err, tenantId: tenant.id }, "Finance reconcile failed for tenant");
    }
  }

  return { totalWritten, tenantsProcessed };
}
