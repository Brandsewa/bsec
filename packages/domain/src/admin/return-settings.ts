import { eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";

export interface ReturnReasonConfig {
  id: string;
  label: string;
  photoRequirement: "required" | "optional" | "not_asked";
}

export interface ReturnSettings {
  acceptReturns: boolean;
  allowExchanges: boolean;
  returnWindowDays: number;
  reasons: ReturnReasonConfig[];
  instructions: string;
  policyText: string;
}

export const DEFAULT_RETURN_REASONS: ReturnReasonConfig[] = [
  { id: "damaged_or_defective", label: "Damaged or defective", photoRequirement: "required" },
  { id: "wrong_item", label: "Wrong item received", photoRequirement: "required" },
  { id: "not_as_described", label: "Not as described", photoRequirement: "required" },
  { id: "size_or_fit", label: "Size or fit", photoRequirement: "optional" },
  { id: "changed_mind", label: "Changed my mind", photoRequirement: "not_asked" },
  { id: "other", label: "Other", photoRequirement: "optional" },
];

export const DEFAULT_RETURN_SETTINGS: ReturnSettings = {
  acceptReturns: true,
  allowExchanges: true,
  returnWindowDays: 7,
  reasons: DEFAULT_RETURN_REASONS,
  instructions: "",
  policyText: "",
};

/**
 * Parses return settings stored in store_settings.return_settings (jsonb).
 * Fallback defaults to existing behaviour (returns accepted, 7-day window, standard reasons).
 */
export function parseReturnSettings(raw: unknown): ReturnSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_RETURN_SETTINGS };
  }
  const s = raw as Record<string, unknown>;

  const acceptReturns = typeof s.acceptReturns === "boolean" ? s.acceptReturns : true;
  const allowExchanges = typeof s.allowExchanges === "boolean" ? s.allowExchanges : true;
  const returnWindowDays =
    typeof s.returnWindowDays === "number" && Number.isFinite(s.returnWindowDays) && s.returnWindowDays >= 1 && s.returnWindowDays <= 90
      ? Math.round(s.returnWindowDays)
      : 7;

  let reasons = DEFAULT_RETURN_REASONS;
  if (Array.isArray(s.reasons) && s.reasons.length > 0) {
    reasons = s.reasons
      .filter((r): r is Record<string, unknown> => r && typeof r === "object")
      .map((r) => ({
        id: String(r.id || crypto.randomUUID()).slice(0, 50),
        label: String(r.label || "").trim().slice(0, 60),
        photoRequirement: (["required", "optional", "not_asked"].includes(String(r.photoRequirement))
          ? String(r.photoRequirement)
          : "optional") as "required" | "optional" | "not_asked",
      }))
      .filter((r) => r.label.length > 0)
      .slice(0, 12);
    if (reasons.length === 0) reasons = DEFAULT_RETURN_REASONS;
  }

  const instructions = typeof s.instructions === "string" ? s.instructions.slice(0, 1000) : "";
  const policyText = typeof s.policyText === "string" ? s.policyText.slice(0, 1000) : "";

  return {
    acceptReturns,
    allowExchanges,
    returnWindowDays,
    reasons,
    instructions,
    policyText,
  };
}

/** Reads this store's return settings. `tx` must already be inside withTenant(). */
export async function readReturnSettings(tx: Db, _tenantId: string): Promise<ReturnSettings> {
  const [row] = await tx
    .select({ returnSettings: schema.storeSettings.returnSettings })
    .from(schema.storeSettings)
    .limit(1);
  return parseReturnSettings(row?.returnSettings);
}

/** Gets return settings for the current tenant. */
export async function getReturnSettings(rt: Runtime, ctx: TenantContext): Promise<ReturnSettings> {
  assertPermission(ctx, "settings.write");
  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    return await readReturnSettings(tx, ctx.tenantId);
  });
}

export interface UpdateReturnSettingsInput {
  acceptReturns?: boolean | undefined;
  allowExchanges?: boolean | undefined;
  returnWindowDays?: number | undefined;
  reasons?: ReturnReasonConfig[] | undefined;
  instructions?: string | undefined;
  policyText?: string | undefined;
}

/** Updates (or initializes) return settings for the current tenant. Audited with a before-and-after diff. */
export async function updateReturnSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateReturnSettingsInput,
): Promise<ReturnSettings> {
  assertPermission(ctx, "settings.write");
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const before = await readReturnSettings(tx, ctx.tenantId);

    const merged: ReturnSettings = {
      acceptReturns: input.acceptReturns !== undefined ? input.acceptReturns : before.acceptReturns,
      allowExchanges: input.allowExchanges !== undefined ? input.allowExchanges : before.allowExchanges,
      returnWindowDays:
        input.returnWindowDays !== undefined
          ? Math.max(1, Math.min(90, Math.round(input.returnWindowDays)))
          : before.returnWindowDays,
      reasons:
        input.reasons !== undefined
          ? input.reasons
              .map((r) => ({
                id: r.id.slice(0, 50),
                label: r.label.trim().slice(0, 60),
                photoRequirement: r.photoRequirement,
              }))
              .filter((r) => r.label.length > 0)
              .slice(0, 12)
          : before.reasons,
      instructions: input.instructions !== undefined ? input.instructions.trim().slice(0, 1000) : before.instructions,
      policyText: input.policyText !== undefined ? input.policyText.trim().slice(0, 1000) : before.policyText,
    };

    if (merged.reasons.length === 0) {
      merged.reasons = DEFAULT_RETURN_REASONS;
    }

    const payload = {
      v: 1,
      ...merged,
    };

    const [existing] = await tx.select({ id: schema.storeSettings.id }).from(schema.storeSettings).limit(1);

    if (!existing) {
      await tx.insert(schema.storeSettings).values({
        tenantId: ctx.tenantId,
        storeName: "Store",
        returnSettings: payload,
      });
    } else {
      await tx
        .update(schema.storeSettings)
        .set({
          returnSettings: payload,
          updatedAt: new Date(),
        })
        .where(eq(schema.storeSettings.id, existing.id));
    }

    // Rule 6: audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "return_settings.update",
      targetType: "return_settings",
      targetId: ctx.tenantId,
      diff: {
        before,
        after: merged,
      },
    });

    return merged;
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return result;
}
