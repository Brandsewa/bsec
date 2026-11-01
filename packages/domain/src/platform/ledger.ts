import { and, desc, eq, ilike, or } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";

export interface StoreTransactionRow {
  id: string;
  tenantId: string;
  tenantName: string;
  orderNumber: string | null;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
}

/**
 * Payments taking place in merchants' stores, across every tenant (read-only, platform staff). The platform database role
 * bypasses row-level security, so every row carries its tenant and nothing here is ever summed across currencies.
 */
export async function listPlatformStoreTransactions(
  rt: Runtime,
  input?: { search?: string | undefined; status?: string | undefined; provider?: string | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<StoreTransactionRow[]> {
  const term = input?.search?.trim();
  const filters = [
    input?.status ? eq(schema.paymentIntents.status, input.status) : undefined,
    input?.provider ? eq(schema.paymentIntents.provider, input.provider) : undefined,
    term ? or(ilike(schema.tenants.name, `%${term}%`), ilike(schema.orders.number, `%${term}%`)) : undefined,
  ].filter((f) => f !== undefined);

  const rows = await rt._db.db
    .select({
      id: schema.paymentIntents.id,
      tenantId: schema.paymentIntents.tenantId,
      tenantName: schema.tenants.name,
      orderNumber: schema.orders.number,
      provider: schema.paymentIntents.provider,
      amount: schema.paymentIntents.amount,
      currency: schema.paymentIntents.currency,
      status: schema.paymentIntents.status,
      createdAt: schema.paymentIntents.createdAt,
    })
    .from(schema.paymentIntents)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.paymentIntents.tenantId))
    .leftJoin(schema.orders, and(eq(schema.orders.id, schema.paymentIntents.orderId), eq(schema.orders.tenantId, schema.paymentIntents.tenantId)))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(schema.paymentIntents.createdAt))
    .limit(Math.min(input?.limit ?? 50, 200))
    .offset(input?.offset ?? 0);

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId ?? "",
    tenantName: r.tenantName,
    orderNumber: r.orderNumber,
    provider: r.provider,
    amount: Number(r.amount),
    currency: r.currency,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}
