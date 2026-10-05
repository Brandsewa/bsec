import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type {
  TaxSettings,
  UpdateTaxSettingsInput,
  TaxClassItem,
  CreateTaxClassInput,
  UpdateTaxClassInput,
} from "@bs/contracts";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { validateGstin } from "../orders/gst-validation.ts";

export interface TaxConfigJson {
  taxCollection?: boolean | undefined;
  gstin?: string | null | undefined;
  sellerState?: string | null | undefined;
  pricesIncludeTax?: boolean | undefined;
  shippingTax?: "highest_line_rate" | "none" | undefined;
  defaultTaxClassId?: string | null | undefined;
  version?: number | undefined;
}

/**
 * Ensures a standard 18% default tax class exists for the tenant lazily if gst_v2 is enabled or classes table is queried.
 */
export async function ensureDefaultTaxClass(tx: Db, tenantId: string): Promise<TaxClassItem> {
  const existingClasses = await tx
    .select()
    .from(schema.taxClasses)
    .where(eq(schema.taxClasses.tenantId, tenantId))
    .orderBy(sql`${schema.taxClasses.isDefault} DESC, ${schema.taxClasses.createdAt} ASC`);

  const firstClass = existingClasses[0];
  if (firstClass) {
    const def = existingClasses.find((c) => c.isDefault) ?? firstClass;
    return {
      id: def.id,
      name: def.name,
      rateBps: def.rateBps,
      defaultHsn: def.defaultHsn ?? null,
      isDefault: def.isDefault,
      createdAt: def.createdAt.toISOString(),
      updatedAt: def.updatedAt.toISOString(),
    };
  }

  // Seed "Standard 18%"
  const [created] = await tx
    .insert(schema.taxClasses)
    .values({
      tenantId,
      name: "Standard 18%",
      rateBps: 1800,
      isDefault: true,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to seed default tax class");
  }

  return {
    id: created.id,
    name: created.name,
    rateBps: created.rateBps,
    defaultHsn: created.defaultHsn ?? null,
    isDefault: created.isDefault,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

/**
 * Reads all tax classes for the tenant.
 */
export async function listTaxClasses(
  rt: Runtime,
  ctx: TenantContext,
): Promise<TaxClassItem[]> {
  assertPermission(ctx, "settings.read");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    // Check if lazy seeding is needed
    await ensureDefaultTaxClass(tx, ctx.tenantId);

    const rows = await tx
      .select()
      .from(schema.taxClasses)
      .where(eq(schema.taxClasses.tenantId, ctx.tenantId))
      .orderBy(sql`${schema.taxClasses.isDefault} DESC, ${schema.taxClasses.rateBps} ASC, ${schema.taxClasses.name} ASC`);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      rateBps: r.rateBps,
      defaultHsn: r.defaultHsn ?? null,
      isDefault: r.isDefault,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

/**
 * Creates a new tax class.
 */
export async function createTaxClass(
  rt: Runtime,
  ctx: TenantContext,
  input: CreateTaxClassInput,
): Promise<TaxClassItem> {
  assertPermission(ctx, "taxes.manage");

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    if (input.isDefault) {
      // Clear previous default
      await tx
        .update(schema.taxClasses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(schema.taxClasses.tenantId, ctx.tenantId));
    }

    const [created] = await tx
      .insert(schema.taxClasses)
      .values({
        tenantId: ctx.tenantId,
        name: input.name.trim(),
        rateBps: input.rateBps,
        defaultHsn: input.defaultHsn ? input.defaultHsn.trim() : null,
        isDefault: input.isDefault ?? false,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create tax class");
    }

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type === "staff" ? "staff" : "system",
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "tax_class.create",
      targetType: "tax_class",
      targetId: created.id,
      diff: {
        after: {
          name: created.name,
          rateBps: created.rateBps,
          defaultHsn: created.defaultHsn,
          isDefault: created.isDefault,
        },
      },
    });

    return {
      id: created.id,
      name: created.name,
      rateBps: created.rateBps,
      defaultHsn: created.defaultHsn ?? null,
      isDefault: created.isDefault,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  });
}

/**
 * Updates a tax class.
 */
export async function updateTaxClass(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateTaxClassInput,
): Promise<TaxClassItem> {
  assertPermission(ctx, "taxes.manage");

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.taxClasses)
      .where(and(eq(schema.taxClasses.tenantId, ctx.tenantId), eq(schema.taxClasses.id, input.id)))
      .limit(1);

    if (!existing) {
      throw new Error("Not Found: Tax class not found");
    }

    if (input.isDefault) {
      // Clear previous default
      await tx
        .update(schema.taxClasses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(schema.taxClasses.tenantId, ctx.tenantId));
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.rateBps !== undefined) updates.rateBps = input.rateBps;
    if (input.defaultHsn !== undefined) updates.defaultHsn = input.defaultHsn ? input.defaultHsn.trim() : null;
    if (input.isDefault !== undefined) updates.isDefault = input.isDefault;

    const [updated] = await tx
      .update(schema.taxClasses)
      .set(updates)
      .where(and(eq(schema.taxClasses.tenantId, ctx.tenantId), eq(schema.taxClasses.id, input.id)))
      .returning();

    if (!updated) {
      throw new Error("Failed to update tax class");
    }

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type === "staff" ? "staff" : "system",
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "tax_class.update",
      targetType: "tax_class",
      targetId: updated.id,
      diff: {
        before: {
          name: existing.name,
          rateBps: existing.rateBps,
          defaultHsn: existing.defaultHsn,
          isDefault: existing.isDefault,
        },
        after: {
          name: updated.name,
          rateBps: updated.rateBps,
          defaultHsn: updated.defaultHsn,
          isDefault: updated.isDefault,
        },
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      rateBps: updated.rateBps,
      defaultHsn: updated.defaultHsn ?? null,
      isDefault: updated.isDefault,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}

/**
 * Deletes a tax class if it is not in use by any product and not default.
 */
export async function deleteTaxClass(
  rt: Runtime,
  ctx: TenantContext,
  id: string,
): Promise<{ ok: true }> {
  assertPermission(ctx, "taxes.manage");

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.taxClasses)
      .where(and(eq(schema.taxClasses.tenantId, ctx.tenantId), eq(schema.taxClasses.id, id)))
      .limit(1);

    if (!existing) {
      throw new Error("Not Found: Tax class not found");
    }

    if (existing.isDefault) {
      throw new Error("Conflict: Cannot delete the default tax class");
    }

    // Check if in use by products
    const [inUse] = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, ctx.tenantId), eq(schema.products.taxClassId, id)))
      .limit(1);

    if (inUse) {
      throw new Error("Conflict: Tax class is in use by one or more products");
    }

    await tx
      .delete(schema.taxClasses)
      .where(and(eq(schema.taxClasses.tenantId, ctx.tenantId), eq(schema.taxClasses.id, id)));

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type === "staff" ? "staff" : "system",
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "tax_class.delete",
      targetType: "tax_class",
      targetId: id,
      diff: {
        before: {
          name: existing.name,
          rateBps: existing.rateBps,
        },
      },
    });

    return { ok: true as const };
  });
}

/**
 * Gets tax settings for the tenant.
 */
/**
 * Reads tax settings within an existing transaction.
 */
export async function readTaxSettingsFromTx(
  tx: Db,
  tenantId: string,
): Promise<TaxSettings> {
  await ensureDefaultTaxClass(tx, tenantId);

  const [settingsRow] = await tx
    .select({
      checkout: schema.storeSettings.checkout,
      address: schema.storeSettings.address,
    })
    .from(schema.storeSettings)
    .where(eq(schema.storeSettings.tenantId, tenantId))
    .limit(1);

  const rawCheckout = (settingsRow?.checkout ?? {}) as Record<string, unknown>;
  const rawTax = (rawCheckout.tax ?? {}) as Record<string, unknown>;
  const addressState = (settingsRow?.address as { state?: string } | null | undefined)?.state;

  const classesRows = await tx
    .select()
    .from(schema.taxClasses)
    .where(eq(schema.taxClasses.tenantId, tenantId))
    .orderBy(sql`${schema.taxClasses.isDefault} DESC, ${schema.taxClasses.rateBps} ASC`);

  const classes: TaxClassItem[] = classesRows.map((r) => ({
    id: r.id,
    name: r.name,
    rateBps: r.rateBps,
    defaultHsn: r.defaultHsn ?? null,
    isDefault: r.isDefault,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  const defaultClass = classes.find((c) => c.isDefault) ?? classes[0];

  return {
    taxCollection: typeof rawTax.taxCollection === "boolean" ? rawTax.taxCollection : true,
    gstin: typeof rawTax.gstin === "string" && rawTax.gstin ? rawTax.gstin : null,
    sellerState:
      typeof rawTax.sellerState === "string" && rawTax.sellerState
        ? rawTax.sellerState
        : (addressState ?? null),
    pricesIncludeTax: typeof rawTax.pricesIncludeTax === "boolean" ? rawTax.pricesIncludeTax : true,
    shippingTax: rawTax.shippingTax === "none" ? "none" : "highest_line_rate",
    defaultTaxClassId:
      typeof rawTax.defaultTaxClassId === "string" && rawTax.defaultTaxClassId
        ? rawTax.defaultTaxClassId
        : (defaultClass?.id ?? null),
    classes,
    version: typeof rawTax.version === "number" ? rawTax.version : 1,
  };
}

/**
 * Gets tax settings for the tenant.
 */
export async function getTaxSettings(
  rt: Runtime,
  ctx: TenantContext,
): Promise<TaxSettings> {
  assertPermission(ctx, "settings.read");
  return withTenant(rt._db.db, ctx.tenantId, (tx) => readTaxSettingsFromTx(tx, ctx.tenantId));
}

/**
 * Updates tax settings for the tenant.
 * Enforces:
 * 1. `taxes.manage` permission
 * 2. Optimistic concurrency (expectedVersion)
 * 3. GSTIN validation if gstin is provided (15 char, state code match)
 * 4. Audit logging
 */
export async function updateTaxSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateTaxSettingsInput,
): Promise<TaxSettings> {
  assertPermission(ctx, "taxes.manage");

  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const before = await readTaxSettingsFromTx(tx, ctx.tenantId);

    // Optimistic concurrency
    if (input.expectedVersion !== undefined && before.version !== input.expectedVersion) {
      throw new Error("Conflict: Tax settings were updated by someone else. Please reload.");
    }

    // GSTIN validation if provided
    let sellerState = input.sellerState !== undefined ? input.sellerState : before.sellerState;
    if (input.gstin) {
      const valResult = validateGstin(input.gstin, sellerState);
      if (!valResult.valid) {
        throw new Error(`Bad Request: ${valResult.error}`);
      }
      // If sellerState was not set, derive from GSTIN
      if (!sellerState && valResult.stateName) {
        sellerState = valResult.stateName;
      }
    }

    const nextVersion = before.version + 1;

    const [settingsRow] = await tx
      .select({
        checkout: schema.storeSettings.checkout,
      })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId))
      .limit(1);

    const checkoutObj = { ...((settingsRow?.checkout ?? {}) as Record<string, unknown>) };
    const currentTax = { ...((checkoutObj.tax ?? {}) as Record<string, unknown>) };

    const newTax: TaxConfigJson = {
      ...currentTax,
      taxCollection: input.taxCollection !== undefined ? input.taxCollection : before.taxCollection,
      gstin: input.gstin !== undefined ? (input.gstin ? input.gstin.trim() : null) : before.gstin,
      sellerState: sellerState ? sellerState.trim() : null,
      pricesIncludeTax:
        input.pricesIncludeTax !== undefined ? input.pricesIncludeTax : before.pricesIncludeTax,
      shippingTax: input.shippingTax !== undefined ? input.shippingTax : before.shippingTax,
      defaultTaxClassId:
        input.defaultTaxClassId !== undefined ? input.defaultTaxClassId : before.defaultTaxClassId,
      version: nextVersion,
    };

    checkoutObj.tax = newTax;

    await tx
      .update(schema.storeSettings)
      .set({
        checkout: checkoutObj,
        updatedAt: new Date(),
      })
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId));

    // Audit diff
    const diff: Record<string, { before: unknown; after: unknown }> = {};
    const trackKeys = ["taxCollection", "gstin", "sellerState", "pricesIncludeTax", "shippingTax", "defaultTaxClassId"] as const;
    for (const k of trackKeys) {
      if (input[k] !== undefined && input[k] !== before[k]) {
        diff[k] = { before: before[k], after: input[k] };
      }
    }

    if (Object.keys(diff).length > 0) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type === "staff" ? "staff" : "system",
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "taxes.update",
        targetType: "store_settings",
        targetId: ctx.tenantId,
        diff,
      });
    }

    return await readTaxSettingsFromTx(tx, ctx.tenantId);
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });

  return result;
}

/**
 * Resolves effective tax class for a product.
 * Falls back to tenant's default tax class. If neither exists, throws error.
 */
export async function resolveTaxClass(
  tx: Db,
  tenantId: string,
  taxClassId?: string | null,
): Promise<{ id: string; name: string; rateBps: number; defaultHsn: string | null }> {
  if (taxClassId) {
    const [found] = await tx
      .select()
      .from(schema.taxClasses)
      .where(and(eq(schema.taxClasses.tenantId, tenantId), eq(schema.taxClasses.id, taxClassId)))
      .limit(1);
    if (found) {
      return {
        id: found.id,
        name: found.name,
        rateBps: found.rateBps,
        defaultHsn: found.defaultHsn ?? null,
      };
    }
  }

  // Fallback to store default tax class
  const def = await ensureDefaultTaxClass(tx, tenantId);
  return {
    id: def.id,
    name: def.name,
    rateBps: def.rateBps,
    defaultHsn: def.defaultHsn ?? null,
  };
}
