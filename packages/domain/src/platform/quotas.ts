import { and, asc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import type {
  CreateQuotaTierInput,
  QuotaDefinitionView,
  QuotaMatrixView,
  QuotaTierLimitView,
  QuotaTierView,
  UpdateQuotaDefinitionInput,
  UpdateQuotaLimitsInput,
  UpdateQuotaTierInput,
} from "@bs/contracts";

/**
 * Returns the quota matrix: all tiers with store counts, all definitions, and all tier limits.
 */
export async function getPlatformQuotaMatrix(rt: Runtime): Promise<QuotaMatrixView> {
  const tiersRows = await rt._db.db
    .select()
    .from(schema.quotaTiers)
    .orderBy(asc(schema.quotaTiers.sort), asc(schema.quotaTiers.code));

  // Count active/trial stores assigned to each tier
  const storeCounts = await rt._db.db.execute<{ tier: string; count: string }>(sql`
    SELECT UPPER(tier) as tier, COUNT(*)::text as count
    FROM tenant_size_tiers
    GROUP BY UPPER(tier);
  `);
  const countsMap = new Map<string, number>();
  for (const r of storeCounts.rows) {
    countsMap.set(r.tier, parseInt(r.count, 10));
  }

  const defRows = await rt._db.db
    .select()
    .from(schema.quotaDefinitions)
    .orderBy(asc(schema.quotaDefinitions.key));

  const limitsRows = await rt._db.db
    .select()
    .from(schema.quotaTierLimits)
    .orderBy(asc(schema.quotaTierLimits.tierCode), asc(schema.quotaTierLimits.quotaKey));

  const tiers: QuotaTierView[] = tiersRows.map((t) => ({
    code: t.code,
    name: t.name,
    description: t.description,
    sort: t.sort,
    isActive: t.isActive,
    priceMonthlyPaise: Number(t.priceMonthlyPaise),
    priceYearlyPaise: Number(t.priceYearlyPaise),
    currency: t.currency,
    isPublic: t.isPublic,
    storeCount: countsMap.get(t.code.toUpperCase()) ?? 0,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  const definitions: QuotaDefinitionView[] = defRows.map((d) => ({
    key: d.key,
    description: d.description,
    unit: d.unit,
    enforcement: d.enforcement as "hard" | "soft" | "notify",
    tierXs: d.tierXs,
    tierS: d.tierS,
    tierM: d.tierM,
    tierL: d.tierL,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));

  const limits: QuotaTierLimitView[] = limitsRows.map((l) => ({
    tierCode: l.tierCode,
    quotaKey: l.quotaKey,
    value: l.value,
  }));

  return {
    tiers,
    definitions,
    limits,
  };
}

/**
 * Creates a new quota tier and populates initial limits from the default tier (XS).
 */
export async function createPlatformQuotaTier(
  rt: Runtime,
  platformStaffUserId: string | null | undefined,
  input: CreateQuotaTierInput,
  meta?: AuditMeta,
): Promise<{ ok: boolean; code: string }> {
  const code = input.code.trim().toUpperCase();

  const [existing] = await rt._db.db
    .select()
    .from(schema.quotaTiers)
    .where(eq(schema.quotaTiers.code, code))
    .limit(1);

  if (existing) {
    throw new Error(`Quota tier with code "${code}" already exists`);
  }

  return rt._db.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.quotaTiers)
      .values({
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        sort: input.sort ?? 0,
        isActive: true,
        priceMonthlyPaise: input.priceMonthlyPaise ?? 0,
        priceYearlyPaise: input.priceYearlyPaise ?? 0,
        currency: input.currency ?? "INR",
        isPublic: input.isPublic ?? true,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create quota tier");
    }

    // Populate initial limits from XS tier
    const xsLimits = await tx
      .select()
      .from(schema.quotaTierLimits)
      .where(eq(schema.quotaTierLimits.tierCode, "XS"));

    if (xsLimits.length > 0) {
      await tx.insert(schema.quotaTierLimits).values(
        xsLimits.map((l) => ({
          tierCode: code,
          quotaKey: l.quotaKey,
          value: l.value,
        })),
      );
    } else {
      const defs = await tx.select().from(schema.quotaDefinitions);
      if (defs.length > 0) {
        await tx.insert(schema.quotaTierLimits).values(
          defs.map((d) => ({
            tierCode: code,
            quotaKey: d.key,
            value: d.tierXs,
          })),
        );
      }
    }

    await writePlatformAudit(
      tx,
      platformStaffUserId ?? undefined,
      "quota_tier.created",
      "quota_tier",
      code,
      null,
      {
        code: created.code,
        name: created.name,
        priceMonthlyPaise: created.priceMonthlyPaise,
        priceYearlyPaise: created.priceYearlyPaise,
      },
      meta,
    );

    return { ok: true, code };
  });
}

/**
 * Updates tier metadata and pricing. Refuses deactivation if tenants are currently on this tier.
 */
export async function updatePlatformQuotaTier(
  rt: Runtime,
  platformStaffUserId: string | null | undefined,
  input: UpdateQuotaTierInput,
  meta?: AuditMeta,
): Promise<{ ok: boolean }> {
  const code = input.code.trim().toUpperCase();

  const [before] = await rt._db.db
    .select()
    .from(schema.quotaTiers)
    .where(eq(schema.quotaTiers.code, code))
    .limit(1);

  if (!before) {
    throw new Error(`Quota tier "${code}" not found`);
  }

  // Refusal invariant: cannot deactivate tier in use
  if (input.isActive === false && before.isActive === true) {
    const countRes = await rt._db.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text as count FROM tenant_size_tiers WHERE UPPER(tier) = ${code};
    `);
    const inUseCount = parseInt(countRes.rows[0]?.count ?? "0", 10);
    if (inUseCount > 0) {
      throw new Error(
        `Cannot deactivate tier "${code}": ${inUseCount} store(s) are currently on this tier. Reassign them before deactivating.`,
      );
    }
  }

  return rt._db.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.quotaTiers)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.priceMonthlyPaise !== undefined ? { priceMonthlyPaise: input.priceMonthlyPaise } : {}),
        ...(input.priceYearlyPaise !== undefined ? { priceYearlyPaise: input.priceYearlyPaise } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.quotaTiers.code, code))
      .returning();

    if (!updated) {
      throw new Error(`Failed to update quota tier "${code}"`);
    }

    await writePlatformAudit(
      tx,
      platformStaffUserId ?? undefined,
      "quota_tier.updated",
      "quota_tier",
      code,
      null,
      {
        before: {
          name: before.name,
          isActive: before.isActive,
          priceMonthlyPaise: before.priceMonthlyPaise,
          priceYearlyPaise: before.priceYearlyPaise,
        },
        after: {
          name: updated.name,
          isActive: updated.isActive,
          priceMonthlyPaise: updated.priceMonthlyPaise,
          priceYearlyPaise: updated.priceYearlyPaise,
        },
      },
      meta,
    );

    return { ok: true };
  });
}

/**
 * Deactivates a quota tier. Refuses if any tenants currently use the tier.
 */
export async function deactivatePlatformQuotaTier(
  rt: Runtime,
  platformStaffUserId: string | null | undefined,
  code: string,
  meta?: AuditMeta,
): Promise<{ ok: boolean }> {
  return updatePlatformQuotaTier(rt, platformStaffUserId, { code, isActive: false }, meta);
}

/**
 * Atomically updates quota limits in batch. Writes through to legacy quota_definitions.tier_xs/s/m/l.
 */
export async function updatePlatformQuotaLimits(
  rt: Runtime,
  platformStaffUserId: string | null | undefined,
  input: UpdateQuotaLimitsInput,
  meta?: AuditMeta,
): Promise<{ ok: boolean; updatedCount: number }> {
  return rt._db.db.transaction(async (tx) => {
    const beforeRows: Array<{ tierCode: string; quotaKey: string; value: number }> = [];

    for (const u of input.updates) {
      const [existing] = await tx
        .select()
        .from(schema.quotaTierLimits)
        .where(
          and(
            eq(schema.quotaTierLimits.tierCode, u.tierCode),
            eq(schema.quotaTierLimits.quotaKey, u.quotaKey),
          ),
        )
        .limit(1);

      if (existing) {
        beforeRows.push({ tierCode: existing.tierCode, quotaKey: existing.quotaKey, value: existing.value });
      }

      await tx
        .insert(schema.quotaTierLimits)
        .values({
          tierCode: u.tierCode,
          quotaKey: u.quotaKey,
          value: u.value,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.quotaTierLimits.tierCode, schema.quotaTierLimits.quotaKey],
          set: { value: u.value, updatedAt: new Date() },
        });

      // Write-through to legacy columns in quota_definitions for XS, S, M, L
      const upperTier = u.tierCode.toUpperCase();
      if (upperTier === "XS") {
        await tx
          .update(schema.quotaDefinitions)
          .set({ tierXs: u.value, updatedAt: new Date() })
          .where(eq(schema.quotaDefinitions.key, u.quotaKey));
      } else if (upperTier === "S") {
        await tx
          .update(schema.quotaDefinitions)
          .set({ tierS: u.value, updatedAt: new Date() })
          .where(eq(schema.quotaDefinitions.key, u.quotaKey));
      } else if (upperTier === "M") {
        await tx
          .update(schema.quotaDefinitions)
          .set({ tierM: u.value, updatedAt: new Date() })
          .where(eq(schema.quotaDefinitions.key, u.quotaKey));
      } else if (upperTier === "L") {
        await tx
          .update(schema.quotaDefinitions)
          .set({ tierL: u.value, updatedAt: new Date() })
          .where(eq(schema.quotaDefinitions.key, u.quotaKey));
      }
    }

    await writePlatformAudit(
      tx,
      platformStaffUserId ?? undefined,
      "quota_limits.updated",
      "quota_limits",
      "batch",
      null,
      { before: beforeRows, after: input.updates },
      meta,
    );

    return { ok: true, updatedCount: input.updates.length };
  });
}

/**
 * Updates description, unit, or enforcement for a quota definition. Keys remain code-defined.
 */
export async function updatePlatformQuotaDefinition(
  rt: Runtime,
  platformStaffUserId: string | null | undefined,
  input: UpdateQuotaDefinitionInput,
  meta?: AuditMeta,
): Promise<{ ok: boolean }> {
  return rt._db.db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.quotaDefinitions)
      .where(eq(schema.quotaDefinitions.key, input.key))
      .limit(1);

    if (!before) {
      throw new Error(`Quota definition "${input.key}" not found`);
    }

    const [updated] = await tx
      .update(schema.quotaDefinitions)
      .set({
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.unit !== undefined ? { unit: input.unit.trim() } : {}),
        ...(input.enforcement !== undefined ? { enforcement: input.enforcement } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.quotaDefinitions.key, input.key))
      .returning();

    if (!updated) {
      throw new Error(`Failed to update quota definition "${input.key}"`);
    }

    await writePlatformAudit(
      tx,
      platformStaffUserId ?? undefined,
      "quota_definition.updated",
      "quota_definition",
      input.key,
      null,
      {
        before: { description: before.description, unit: before.unit, enforcement: before.enforcement },
        after: { description: updated.description, unit: updated.unit, enforcement: updated.enforcement },
      },
      meta,
    );

    return { ok: true };
  });
}
