import { eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";

/** Fee charged for Cash on Delivery when a store has not set its own. */
export const DEFAULT_COD_FEE_PAISE = 5000;

export interface StoreConfig {
  cod: { enabled: boolean; feePaise: number };
  tax: { gstin: string | null; sellerState: string | null; pricesIncludeTax: boolean };
}

export interface StoreAddressRecord {
  countryCode?: string | undefined;
  line1?: string | undefined;
  line2?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  pincode?: string | undefined;
}

export interface StoreSettingsRecord extends StoreConfig {
  tenantId: string;
  storeName: string;
  currency: string;
  timezone: string;
  legalName: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  address: StoreAddressRecord | null;
  orderPrefix: string;
  autoPublishReviews: boolean;
}

export interface UpdateStoreSettingsInput {
  storeName?: string | undefined;
  currency?: string | undefined;
  timezone?: string | undefined;
  legalName?: string | null | undefined;
  supportEmail?: string | null | undefined;
  supportPhone?: string | null | undefined;
  address?: StoreAddressRecord | null | undefined;
  orderPrefix?: string | undefined;
  autoPublishReviews?: boolean | undefined;
  cod?: { enabled: boolean; feePaise: number } | undefined;
  tax?: { gstin: string | null; sellerState: string | null; pricesIncludeTax: boolean } | undefined;
}

/**
 * Per-store checkout and tax options live in store_settings.checkout (jsonb). Missing values fall back
 * to the behaviour stores had before these became configurable, so existing stores are unchanged.
 */
export function parseStoreConfig(raw: unknown): StoreConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as {
    cod?: { enabled?: unknown; feePaise?: unknown };
    tax?: { gstin?: unknown; sellerState?: unknown; pricesIncludeTax?: unknown };
  };
  return {
    cod: {
      enabled: typeof c.cod?.enabled === "boolean" ? c.cod.enabled : true,
      feePaise:
        typeof c.cod?.feePaise === "number" && Number.isFinite(c.cod.feePaise) && c.cod.feePaise >= 0
          ? Math.round(c.cod.feePaise)
          : DEFAULT_COD_FEE_PAISE,
    },
    tax: {
      gstin: typeof c.tax?.gstin === "string" && c.tax.gstin ? c.tax.gstin : null,
      sellerState: typeof c.tax?.sellerState === "string" && c.tax.sellerState ? c.tax.sellerState : null,
      pricesIncludeTax: typeof c.tax?.pricesIncludeTax === "boolean" ? c.tax.pricesIncludeTax : true,
    },
  };
}

/** Reads this store's config. `tx` must already be inside withTenant() for that store. */
export async function readStoreConfig(tx: Db): Promise<StoreConfig> {
  const [row] = await tx.select({ checkout: schema.storeSettings.checkout }).from(schema.storeSettings).limit(1);
  return parseStoreConfig(row?.checkout);
}

function toAddress(raw: unknown): StoreAddressRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const pick = (k: string) => (typeof a[k] === "string" && a[k] ? (a[k] as string) : undefined);
  return {
    countryCode: pick("countryCode"),
    line1: pick("line1"),
    line2: pick("line2"),
    city: pick("city"),
    state: pick("state"),
    pincode: pick("pincode"),
  };
}

type SettingsRow = typeof schema.storeSettings.$inferSelect;

function toRecord(row: SettingsRow, tenantId: string): StoreSettingsRecord {
  return {
    tenantId,
    storeName: row.storeName,
    currency: row.currency,
    timezone: row.timezone,
    legalName: row.legalName ?? null,
    supportEmail: row.supportEmail ?? null,
    supportPhone: row.supportPhone ?? null,
    address: toAddress(row.address),
    orderPrefix: row.orderPrefix,
    autoPublishReviews: Boolean(row.autoPublishReviews),
    ...parseStoreConfig(row.checkout),
  };
}

async function tenantDefaults(tx: Db, tenantId: string) {
  const [tenant] = await tx
    .select({ name: schema.tenants.name, currency: schema.tenants.currency, timezone: schema.tenants.timezone })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  return {
    storeName: tenant?.name ?? "My store",
    currency: tenant?.currency ?? "INR",
    timezone: tenant?.timezone ?? "Asia/Kolkata",
  };
}

/** Gets store settings for the current tenant (PLAN §5.4). Runs inside withTenant(). */
export async function getStoreSettings(rt: Runtime, ctx: TenantContext): Promise<StoreSettingsRecord> {
  assertPermission(ctx, "settings.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(schema.storeSettings).limit(1);
    if (row) return toRecord(row, ctx.tenantId);
    const d = await tenantDefaults(tx, ctx.tenantId);
    return {
      tenantId: ctx.tenantId,
      ...d,
      legalName: null,
      supportEmail: null,
      supportPhone: null,
      address: null,
      orderPrefix: "#",
      autoPublishReviews: false,
      ...parseStoreConfig(null),
    };
  });
}

const AUDIT_FIELDS = ["storeName", "currency", "timezone", "legalName", "supportEmail", "supportPhone", "address", "autoPublishReviews"] as const;

/** Writes the audit_logs row for a store settings change (AGENTS.md rule 6). No secrets exist here; the
 * checkout/tax groups are audited through their own canonical editors, not this aggregate's diff. */
async function writeSettingsAudit(tx: Db, ctx: TenantContext, before: StoreSettingsRecord | null, after: StoreSettingsRecord) {
  const pickChanges = (r: StoreSettingsRecord) => ({
    storeName: r.storeName,
    currency: r.currency,
    timezone: r.timezone,
    legalName: r.legalName,
    supportEmail: r.supportEmail,
    supportPhone: r.supportPhone,
    address: r.address,
    autoPublishReviews: r.autoPublishReviews,
  });
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of AUDIT_FIELDS) {
    const b = before ? pickChanges(before)[key] : undefined;
    const a = pickChanges(after)[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) diff[key] = { before: b ?? null, after: a };
  }
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action: "store_settings.update",
    targetType: "store_settings",
    targetId: ctx.tenantId,
    diff,
  });
}

/** Updates (or creates on first save) store settings for the current tenant. */
export async function updateStoreSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateStoreSettingsInput,
): Promise<StoreSettingsRecord> {
  assertPermission(ctx, "settings.write");
  if (input.cod !== undefined) {
    throw new Error(
      "Cash on Delivery settings must be updated via admin.paymentMethods.updateCod with payments.manage permission.",
    );
  }
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx.select().from(schema.storeSettings).limit(1);
    const before = existing ? toRecord(existing, ctx.tenantId) : null;
    const current = parseStoreConfig(existing?.checkout);
    const rawCheckout = (existing?.checkout && typeof existing.checkout === "object" ? existing.checkout : {}) as Record<string, unknown>;
    const checkout = {
      ...rawCheckout,
      cod: input.cod ?? current.cod,
      tax: input.tax ?? current.tax,
    };

    // The address jsonb gains countryCode "IN" (V1 India-only) unless the caller set one; existing
    // stored values are never rewritten (Settings rebuild prompt §D).
    const address =
      input.address === undefined
        ? undefined
        : input.address === null
          ? null
          : { countryCode: input.address.countryCode ?? before?.address?.countryCode ?? "IN", ...input.address };

    const fields = {
      ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
      ...(input.supportEmail !== undefined ? { supportEmail: input.supportEmail } : {}),
      ...(input.supportPhone !== undefined ? { supportPhone: input.supportPhone } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(input.orderPrefix !== undefined ? { orderPrefix: input.orderPrefix } : {}),
      ...(input.autoPublishReviews !== undefined ? { autoPublishReviews: input.autoPublishReviews } : {}),
      checkout,
      updatedAt: new Date(),
    };

    if (!existing) {
      const d = await tenantDefaults(tx, ctx.tenantId);
      const [created] = await tx
        .insert(schema.storeSettings)
        .values({
          tenantId: ctx.tenantId,
          storeName: input.storeName ?? d.storeName,
          currency: input.currency ?? d.currency,
          timezone: input.timezone ?? d.timezone,
          autoPublishReviews: input.autoPublishReviews ?? false,
          ...fields,
        })
        .returning();
      if (!created) throw new Error("Failed to initialize store settings");
      const record = toRecord(created, ctx.tenantId);
      await writeSettingsAudit(tx, ctx, null, record);
      return record;
    }

    const [updated] = await tx
      .update(schema.storeSettings)
      .set({
        ...fields,
        ...(input.storeName !== undefined ? { storeName: input.storeName } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      })
      .where(eq(schema.storeSettings.id, existing.id))
      .returning();
    if (!updated) throw new Error("Failed to update store settings");
    const after = toRecord(updated, ctx.tenantId);
    await writeSettingsAudit(tx, ctx, before, after);
    return after;
  });
  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return result;
}
