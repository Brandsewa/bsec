/**
 * Super Admin "Marketplace" (ADR-043): who can see each app, a global on/off, and a per-store suspension. Every change
 * writes `platform_audit_logs` (rule 6) and clears the affected stores' storefront cache.
 */
import { and, count, eq, inArray } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { manifestFor } from "./registry.ts";
import { importPincodeDirectory, parsePincodeJson } from "./pincodes.ts";

function fail(kind: "Bad Request" | "Not Found", message: string): never {
  throw new Error(`${kind}: ${message}`);
}

export interface PlatformAppRecord {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  visibility: "public" | "private";
  allowedTenantIds: string[];
  enabled: boolean;
  installCount: number;
  installs: { tenantId: string; tenantSlug: string; status: string; suspended: boolean }[];
}

export async function listPlatformApps(rt: Runtime, platformStaffUserId: string): Promise<PlatformAppRecord[]> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;
  const catalog = await db.select().from(schema.platformApps).orderBy(schema.platformApps.sort, schema.platformApps.name);
  const installs = await db
    .select({
      appKey: schema.tenantApps.appKey,
      tenantId: schema.tenantApps.tenantId,
      status: schema.tenantApps.status,
      suspended: schema.tenantApps.platformSuspended,
      tenantSlug: schema.tenants.slug,
    })
    .from(schema.tenantApps)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantApps.tenantId));
  return catalog.map((a) => {
    const mine = installs.filter((i) => i.appKey === a.key);
    return {
      key: a.key,
      name: a.name,
      description: a.description,
      icon: a.icon,
      category: a.category,
      visibility: a.visibility as "public" | "private",
      allowedTenantIds: a.allowedTenantIds,
      enabled: a.enabled,
      installCount: mine.length,
      installs: mine.map((i) => ({ tenantId: i.tenantId as string, tenantSlug: i.tenantSlug, status: i.status, suspended: i.suspended })),
    };
  });
}

export interface UpdatePlatformAppInput {
  visibility?: "public" | "private" | undefined;
  allowedTenantIds?: string[] | undefined;
  enabled?: boolean | undefined;
}

export async function updatePlatformApp(
  rt: Runtime,
  platformStaffUserId: string,
  key: string,
  input: UpdatePlatformAppInput,
  meta?: AuditMeta,
): Promise<PlatformAppRecord> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "manage the marketplace");
  if (!manifestFor(key)) fail("Not Found", "App not found");
  const db = rt._db.db;
  const affected = await db.transaction(async (tx) => {
    const [prev] = await tx.select().from(schema.platformApps).where(eq(schema.platformApps.key, key)).limit(1);
    if (!prev) fail("Not Found", "App not found");
    const allowed = input.allowedTenantIds ? [...new Set(input.allowedTenantIds)] : undefined;
    if (allowed && allowed.length > 0) {
      const found = await tx.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.id, allowed));
      if (found.length !== allowed.length) fail("Bad Request", "Unknown store in the allowed list");
    }
    await tx
      .update(schema.platformApps)
      .set({
        ...(input.visibility ? { visibility: input.visibility } : {}),
        ...(allowed ? { allowedTenantIds: allowed } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.platformApps.key, key));
    await writePlatformAudit(tx, platformStaffUserId, "marketplace.app.update", "app", key, null, {
      visibility: { from: prev.visibility, to: input.visibility ?? prev.visibility },
      enabled: { from: prev.enabled, to: input.enabled ?? prev.enabled },
      allowedTenantIds: { from: prev.allowedTenantIds, to: allowed ?? prev.allowedTenantIds },
    }, meta);
    const installed = await tx.select({ tenantId: schema.tenantApps.tenantId }).from(schema.tenantApps).where(eq(schema.tenantApps.appKey, key));
    return [...new Set([...installed.map((i) => i.tenantId as string), ...prev.allowedTenantIds, ...(allowed ?? [])])];
  });
  for (const tenantId of affected) await invalidateCache(rt, tenantId, { type: "markets_changed" });
  const updated = (await listPlatformApps(rt, platformStaffUserId)).find((a) => a.key === key);
  if (!updated) fail("Not Found", "App not found");
  return updated;
}

/** Turn an app off (or back on) for one store. The store cannot undo a suspension. */
export async function setTenantAppSuspended(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
  key: string,
  suspended: boolean,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "manage the marketplace");
  if (!manifestFor(key)) fail("Not Found", "App not found");
  const db = rt._db.db;
  await db.transaction(async (tx) => {
    const [tenant] = await tx.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!tenant) fail("Not Found", "Store not found");
    const [inst] = await tx
      .select()
      .from(schema.tenantApps)
      .where(and(eq(schema.tenantApps.tenantId, tenantId), eq(schema.tenantApps.appKey, key)))
      .limit(1);
    if (inst) {
      await tx.update(schema.tenantApps).set({ platformSuspended: suspended, updatedAt: new Date() }).where(eq(schema.tenantApps.id, inst.id));
    } else if (suspended) {
      // Suspending a store that has not installed the app yet blocks a later install.
      await tx.insert(schema.tenantApps).values({ tenantId, appKey: key, status: "disabled", platformSuspended: true });
    }
    await writePlatformAudit(tx, platformStaffUserId, suspended ? "marketplace.app.suspend" : "marketplace.app.unsuspend", "app", key, tenantId, {
      suspended: { from: inst?.platformSuspended ?? false, to: suspended },
    }, meta);
  });
  await invalidateCache(rt, tenantId, { type: "markets_changed" });
  return { ok: true };
}

export async function getPincodeDirectoryStatus(rt: Runtime, platformStaffUserId: string): Promise<{ count: number }> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const [row] = await rt._db.db.select({ n: count() }).from(schema.platformInPincodes);
  return { count: row?.n ?? 0 };
}

export interface PincodeImportResult {
  imported: number;
  skipped: number;
  total: number;
  /** The first few skipped rows, for the operator to check. */
  skippedSample: string[];
}

/**
 * Loads the India Post pincode directory (JSON keyed by pincode) from Super Admin. Safe to re-run: existing pincodes are
 * updated. Rows without a usable state are skipped and reported, never guessed.
 */
export async function importPincodesFromJson(rt: Runtime, platformStaffUserId: string, text: string, meta?: AuditMeta): Promise<PincodeImportResult> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "load the pincode directory");
  if (text.length > 6_000_000) fail("Bad Request", "The file is too large");
  let parsed: ReturnType<typeof parsePincodeJson>;
  try {
    parsed = parsePincodeJson(text);
  } catch (err) {
    fail("Bad Request", err instanceof SyntaxError ? "The file is not valid JSON" : err instanceof Error ? err.message : "Could not read the file");
  }
  if (parsed.rows.length < 100) fail("Bad Request", "The file has too few usable pincodes to be the India Post directory");
  const { imported } = await importPincodeDirectory(rt, parsed.rows);
  await writePlatformAudit(rt._db.db, platformStaffUserId, "marketplace.pincodes.import", "pincode_directory", "in", null, { imported, skipped: parsed.skipped.length }, meta);
  return { imported, skipped: parsed.skipped.length, total: imported + parsed.skipped.length, skippedSample: parsed.skipped.slice(0, 10).map((s) => s.reason) };
}
