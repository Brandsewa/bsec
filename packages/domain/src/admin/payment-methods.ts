import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { readStoreConfig } from "./store-config.ts";

export interface CodPublicConfig {
  v: 1;
  feePaise: number;
  minOrderPaise?: number | null | undefined;
  maxOrderPaise?: number | null | undefined;
}

export interface PaymentMethodRecord {
  id: string;
  provider: "cod" | "razorpay";
  displayName: string;
  status: "disabled" | "pending_setup" | "active" | "unavailable" | "error";
  mode: "live" | "test" | null;
  sortOrder: number;
  publicConfig: Record<string, unknown>;
  setupState: Record<string, unknown>;
  version: number;
  enabledAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCodMethodInput {
  enabled: boolean;
  displayName?: string | undefined;
  feePaise: number;
  minOrderPaise?: number | null | undefined;
  maxOrderPaise?: number | null | undefined;
}

/**
 * Checks whether an active adapter is enabled for an online provider.
 * Since Razorpay is gated and no active checkout adapter exists in the registry, online providers return false.
 */
export function hasEnabledPaymentAdapter(provider: string): boolean {
  if (provider === "cod") return true;
  return false;
}

/**
 * Normalizes COD public config.
 */
export function parseCodPublicConfig(raw: unknown): CodPublicConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const feePaise = typeof obj.feePaise === "number" && obj.feePaise >= 0 ? Math.min(50000, Math.round(obj.feePaise)) : 5000;
  const minOrderPaise = typeof obj.minOrderPaise === "number" && obj.minOrderPaise >= 0 ? Math.round(obj.minOrderPaise) : null;
  const maxOrderPaise = typeof obj.maxOrderPaise === "number" && obj.maxOrderPaise >= 0 ? Math.round(obj.maxOrderPaise) : null;
  return {
    v: 1,
    feePaise,
    minOrderPaise,
    maxOrderPaise,
  };
}

/**
 * Dual-read reader: returns rows from payment_methods if present,
 * otherwise synthesizes COD method from store_settings.checkout.cod.
 */
export async function getTenantPaymentMethods(
  tx: Db,
  tenantId: string,
): Promise<PaymentMethodRecord[]> {
  const rows = await tx
    .select()
    .from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.tenantId, tenantId))
    .orderBy(asc(schema.paymentMethods.sortOrder));

  const methods: PaymentMethodRecord[] = [];

  const codRow = rows.find((r) => r.provider === "cod");
  if (codRow) {
    methods.push({
      id: codRow.id,
      provider: "cod",
      displayName: codRow.displayName,
      status: codRow.status as "disabled" | "pending_setup" | "active" | "unavailable" | "error",
      mode: (codRow.mode as "live" | "test") ?? null,
      sortOrder: codRow.sortOrder,
      publicConfig: (codRow.publicConfig as Record<string, unknown>) ?? {},
      setupState: (codRow.setupState as Record<string, unknown>) ?? {},
      version: codRow.version,
      enabledAt: codRow.enabledAt?.toISOString() ?? null,
      disabledAt: codRow.disabledAt?.toISOString() ?? null,
      createdAt: codRow.createdAt.toISOString(),
      updatedAt: codRow.updatedAt.toISOString(),
    });
  } else {
    // Synthesize COD method from store_settings.checkout.cod
    const cfg = await readStoreConfig(tx);
    const codActive = cfg.cod.enabled;
    methods.push({
      id: "00000000-0000-0000-0000-000000000000",
      provider: "cod",
      displayName: "Cash on Delivery (COD)",
      status: codActive ? "active" : "disabled",
      mode: null,
      sortOrder: 0,
      publicConfig: {
        v: 1,
        feePaise: cfg.cod.feePaise,
        minOrderPaise: null,
        maxOrderPaise: null,
      },
      setupState: {
        v: 1,
        configured: true,
        requiredSecretsPresent: [],
      },
      version: 1,
      enabledAt: codActive ? new Date().toISOString() : null,
      disabledAt: !codActive ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const rzpRow = rows.find((r) => r.provider === "razorpay");
  if (rzpRow) {
    methods.push({
      id: rzpRow.id,
      provider: "razorpay",
      displayName: rzpRow.displayName,
      status: rzpRow.status as "disabled" | "pending_setup" | "active" | "unavailable" | "error",
      mode: (rzpRow.mode as "live" | "test") ?? null,
      sortOrder: rzpRow.sortOrder,
      publicConfig: (rzpRow.publicConfig as Record<string, unknown>) ?? {},
      setupState: (rzpRow.setupState as Record<string, unknown>) ?? {},
      version: rzpRow.version,
      enabledAt: rzpRow.enabledAt?.toISOString() ?? null,
      disabledAt: rzpRow.disabledAt?.toISOString() ?? null,
      createdAt: rzpRow.createdAt.toISOString(),
      updatedAt: rzpRow.updatedAt.toISOString(),
    });
  } else {
    // Razorpay catalog entry (Slice 5A: shows catalogue card as unavailable / coming soon without active adapter)
    methods.push({
      id: "00000000-0000-0000-0000-000000000001",
      provider: "razorpay",
      displayName: "Razorpay",
      status: "unavailable",
      mode: null,
      sortOrder: 1,
      publicConfig: { v: 1 },
      setupState: { v: 1, configured: false, requiredSecretsPresent: [] },
      version: 1,
      enabledAt: null,
      disabledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return methods;
}

/**
 * Lists payment methods catalogue for store admin (Settings > Payments).
 */
export async function listPaymentMethods(
  rt: Runtime,
  ctx: TenantContext,
): Promise<PaymentMethodRecord[]> {
  assertPermission(ctx, "settings.read");
  return withTenant(rt._db.db, ctx.tenantId, (tx) => getTenantPaymentMethods(tx, ctx.tenantId));
}

/**
 * Updates or inserts COD payment method.
 * Requires payments.manage. Dual-writes to store_settings.checkout.cod for rolling deploy safety.
 */
export async function updateCodMethod(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateCodMethodInput,
): Promise<PaymentMethodRecord> {
  assertPermission(ctx, "payments.manage");

  if (input.feePaise < 0 || input.feePaise > 50000) {
    throw new Error("Bad Request: COD fee must be between ₹0 and ₹500 (0 to 50,000 paise)");
  }

  if (
    input.minOrderPaise != null &&
    input.maxOrderPaise != null &&
    input.minOrderPaise > input.maxOrderPaise
  ) {
    throw new Error("Bad Request: Minimum order value cannot exceed maximum order value");
  }

  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.tenantId, ctx.tenantId), eq(schema.paymentMethods.provider, "cod")))
      .limit(1);

    const publicConfig: CodPublicConfig = {
      v: 1,
      feePaise: input.feePaise,
      minOrderPaise: input.minOrderPaise ?? null,
      maxOrderPaise: input.maxOrderPaise ?? null,
    };

    const status = input.enabled ? "active" : "disabled";
    const displayName = input.displayName?.trim() || "Cash on Delivery (COD)";

    let savedRow;
    if (existing) {
      const [updated] = await tx
        .update(schema.paymentMethods)
        .set({
          displayName,
          status,
          publicConfig,
          version: existing.version + 1,
          enabledAt: input.enabled ? existing.enabledAt ?? new Date() : null,
          disabledAt: !input.enabled ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.paymentMethods.tenantId, ctx.tenantId), eq(schema.paymentMethods.id, existing.id)))
        .returning();
      savedRow = updated;
    } else {
      const [inserted] = await tx
        .insert(schema.paymentMethods)
        .values({
          tenantId: ctx.tenantId,
          provider: "cod",
          displayName,
          status,
          mode: null,
          sortOrder: 0,
          publicConfig,
          setupState: { v: 1, configured: true, requiredSecretsPresent: [] },
          version: 1,
          enabledAt: input.enabled ? new Date() : null,
          disabledAt: !input.enabled ? new Date() : null,
        })
        .returning();
      savedRow = inserted;
    }

    if (!savedRow) {
      throw new Error("Failed to save COD payment method");
    }

    // Dual-write to store_settings.checkout.cod for rolling compatibility
    const [stRow] = await tx
      .select({ checkout: schema.storeSettings.checkout })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId))
      .limit(1);

    const currentCheckout = (stRow?.checkout && typeof stRow.checkout === "object" ? stRow.checkout : {}) as Record<string, unknown>;
    const updatedCheckout = {
      ...currentCheckout,
      cod: {
        enabled: input.enabled,
        feePaise: input.feePaise,
      },
    };

    await tx
      .update(schema.storeSettings)
      .set({ checkout: updatedCheckout, updatedAt: new Date() })
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId));

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "payment_methods.cod_update",
      targetType: "payment_methods",
      targetId: savedRow.id,
      diff: {
        enabled: { before: existing?.status === "active", after: input.enabled },
        feePaise: { before: (existing?.publicConfig as Record<string, unknown>)?.feePaise, after: input.feePaise },
        minOrderPaise: { before: (existing?.publicConfig as Record<string, unknown>)?.minOrderPaise, after: input.minOrderPaise },
        maxOrderPaise: { before: (existing?.publicConfig as Record<string, unknown>)?.maxOrderPaise, after: input.maxOrderPaise },
      },
    });

    return {
      id: savedRow.id,
      provider: savedRow.provider as "cod" | "razorpay",
      displayName: savedRow.displayName,
      status: savedRow.status as "disabled" | "pending_setup" | "active" | "unavailable" | "error",
      mode: (savedRow.mode as "live" | "test") ?? null,
      sortOrder: savedRow.sortOrder,
      publicConfig: (savedRow.publicConfig as Record<string, unknown>) ?? {},
      setupState: (savedRow.setupState as Record<string, unknown>) ?? {},
      version: savedRow.version,
      enabledAt: savedRow.enabledAt?.toISOString() ?? null,
      disabledAt: savedRow.disabledAt?.toISOString() ?? null,
      createdAt: savedRow.createdAt.toISOString(),
      updatedAt: savedRow.updatedAt.toISOString(),
    };
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return result;
}
