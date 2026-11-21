/**
 * Apps framework, store side (ADR-043). Every mutation checks `apps.manage`, runs in `withTenant`, writes an audit row
 * and invalidates the tenant's storefront cache. An app is active only when the platform catalog enables it, the store
 * can see it, the store installed it, and Super Admin has not suspended it for that store.
 */
import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { manifestFor } from "./registry.ts";

function fail(kind: "Conflict" | "Bad Request" | "Not Found" | "Forbidden", message: string): never {
  throw new Error(`${kind}: ${message}`);
}

async function storeAppOrFail(tx: Db, tenantId: string, key: string): Promise<StoreAppRecord> {
  const app = (await readStoreApps(tx, tenantId)).find((a) => a.key === key);
  if (!app) fail("Not Found", "App not found");
  return app;
}

export interface StoreAppRecord {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  installed: boolean;
  status: "installed" | "disabled" | null;
  /** Super Admin switched this app off for the store. */
  suspended: boolean;
  /** Pinned to the admin sidebar. */
  pinned: boolean;
  settings: Record<string, unknown>;
}

type CatalogRow = typeof schema.platformApps.$inferSelect;

function visibleTo(app: CatalogRow, tenantId: string): boolean {
  return app.enabled && (app.visibility === "public" || app.allowedTenantIds.includes(tenantId));
}

async function audit(tx: Db, ctx: TenantContext, action: string, key: string, diff: Record<string, unknown>): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType: "app",
    targetId: key,
    diff,
  });
}

export async function readStoreApps(tx: Db, tenantId: string): Promise<StoreAppRecord[]> {
  const catalog = await tx.select().from(schema.platformApps).orderBy(asc(schema.platformApps.sort), asc(schema.platformApps.name));
  const installs = await tx.select().from(schema.tenantApps).where(eq(schema.tenantApps.tenantId, tenantId));
  const byKey = new Map(installs.map((i) => [i.appKey, i]));
  return catalog
    .filter((a) => visibleTo(a, tenantId) || byKey.get(a.key)?.platformSuspended)
    .map((a) => {
      const inst = byKey.get(a.key);
      return {
        key: a.key,
        name: a.name,
        description: a.description,
        icon: a.icon,
        category: a.category,
        installed: !!inst,
        status: (inst?.status as "installed" | "disabled" | undefined) ?? null,
        suspended: inst?.platformSuspended ?? false,
        pinned: inst?.pinned ?? false,
        settings: (inst?.settings as Record<string, unknown> | undefined) ?? {},
      };
    });
}

export async function listStoreApps(rt: Runtime, ctx: TenantContext): Promise<StoreAppRecord[]> {
  assertPermission(ctx, "apps.manage");
  return withTenant(rt._db.db, ctx.tenantId, (tx) => readStoreApps(tx, ctx.tenantId));
}

/** Active = enabled in the platform catalog, installed, switched on by the store and not suspended by Super Admin. Two indexed reads. */
export async function readActiveApp(tx: Db, tenantId: string, key: string): Promise<{ active: boolean; settings: Record<string, unknown> }> {
  const [cat] = await tx.select().from(schema.platformApps).where(eq(schema.platformApps.key, key)).limit(1);
  if (!cat || !cat.enabled) return { active: false, settings: {} };
  const [inst] = await tx
    .select()
    .from(schema.tenantApps)
    .where(and(eq(schema.tenantApps.tenantId, tenantId), eq(schema.tenantApps.appKey, key)))
    .limit(1);
  if (!inst || inst.status !== "installed" || inst.platformSuspended) return { active: false, settings: {} };
  return { active: true, settings: (inst.settings as Record<string, unknown>) ?? {} };
}

export async function isAppActive(rt: Runtime, tenantId: string, key: string): Promise<boolean> {
  return withTenant(rt._db.db, tenantId, async (tx) => (await readActiveApp(tx, tenantId, key)).active);
}

export async function installApp(rt: Runtime, ctx: TenantContext, key: string): Promise<StoreAppRecord> {
  assertPermission(ctx, "apps.manage");
  const manifest = manifestFor(key);
  if (!manifest) fail("Not Found", "App not found");
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [cat] = await tx.select().from(schema.platformApps).where(eq(schema.platformApps.key, key)).limit(1);
    if (!cat || !visibleTo(cat, ctx.tenantId)) fail("Not Found", "App not found");
    const [existing] = await tx
      .select()
      .from(schema.tenantApps)
      .where(and(eq(schema.tenantApps.tenantId, ctx.tenantId), eq(schema.tenantApps.appKey, key)))
      .limit(1);
    if (existing?.platformSuspended) fail("Forbidden", "This app has been turned off for your store by Brand Sewa");
    if (existing) {
      await tx.update(schema.tenantApps).set({ status: "installed", updatedAt: new Date() }).where(eq(schema.tenantApps.id, existing.id));
    } else {
      await tx.insert(schema.tenantApps).values({
        tenantId: ctx.tenantId,
        appKey: key,
        status: "installed",
        settings: manifest.defaultSettings,
        installedBy: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      });
    }
    await audit(tx, ctx, "app.install", key, {});
    return storeAppOrFail(tx, ctx.tenantId, key);
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return result;
}

export async function setAppStatus(rt: Runtime, ctx: TenantContext, key: string, status: "installed" | "disabled"): Promise<StoreAppRecord> {
  assertPermission(ctx, "apps.manage");
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [inst] = await tx
      .select()
      .from(schema.tenantApps)
      .where(and(eq(schema.tenantApps.tenantId, ctx.tenantId), eq(schema.tenantApps.appKey, key)))
      .limit(1);
    if (!inst) fail("Not Found", "Install the app first");
    if (status === "installed" && inst.platformSuspended) fail("Forbidden", "This app has been turned off for your store by Brand Sewa");
    await tx.update(schema.tenantApps).set({ status, updatedAt: new Date() }).where(eq(schema.tenantApps.id, inst.id));
    await audit(tx, ctx, status === "installed" ? "app.enable" : "app.disable", key, { from: inst.status, to: status });
    return storeAppOrFail(tx, ctx.tenantId, key);
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return result;
}

/** Pins or unpins an installed app in the admin sidebar. A store-wide setting, so every staff member sees the same sidebar. */
export async function setAppPinned(rt: Runtime, ctx: TenantContext, key: string, pinned: boolean): Promise<StoreAppRecord> {
  assertPermission(ctx, "apps.manage");
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [inst] = await tx
      .select()
      .from(schema.tenantApps)
      .where(and(eq(schema.tenantApps.tenantId, ctx.tenantId), eq(schema.tenantApps.appKey, key)))
      .limit(1);
    if (!inst) fail("Not Found", "Install the app first");
    if (inst.platformSuspended) fail("Forbidden", "This app has been turned off for your store by Brand Sewa");
    await tx.update(schema.tenantApps).set({ pinned, updatedAt: new Date() }).where(eq(schema.tenantApps.id, inst.id));
    await audit(tx, ctx, pinned ? "app.pin" : "app.unpin", key, {});
    return storeAppOrFail(tx, ctx.tenantId, key);
  });
  return result;
}

/** Removes the install. Data the app wrote (for example state prices) stays in place and is inert until the app is installed again. */
export async function uninstallApp(rt: Runtime, ctx: TenantContext, key: string): Promise<{ removed: true }> {
  assertPermission(ctx, "apps.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [inst] = await tx
      .select()
      .from(schema.tenantApps)
      .where(and(eq(schema.tenantApps.tenantId, ctx.tenantId), eq(schema.tenantApps.appKey, key)))
      .limit(1);
    if (!inst) fail("Not Found", "App is not installed");
    if (inst.platformSuspended) fail("Forbidden", "This app has been turned off for your store by Brand Sewa");
    await tx.delete(schema.tenantApps).where(eq(schema.tenantApps.id, inst.id));
    await audit(tx, ctx, "app.uninstall", key, {});
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return { removed: true };
}

export async function updateAppSettings(rt: Runtime, ctx: TenantContext, key: string, settingsIn: unknown): Promise<StoreAppRecord> {
  assertPermission(ctx, "apps.manage");
  const manifest = manifestFor(key);
  if (!manifest) fail("Not Found", "App not found");
  const parsed = manifest.settingsSchema.safeParse(settingsIn);
  if (!parsed.success) fail("Bad Request", "Invalid settings");
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [inst] = await tx
      .select()
      .from(schema.tenantApps)
      .where(and(eq(schema.tenantApps.tenantId, ctx.tenantId), eq(schema.tenantApps.appKey, key)))
      .limit(1);
    if (!inst) fail("Not Found", "Install the app first");
    await tx
      .update(schema.tenantApps)
      .set({ settings: parsed.data, settingsVersion: inst.settingsVersion + 1, updatedAt: new Date() })
      .where(eq(schema.tenantApps.id, inst.id));
    await audit(tx, ctx, "app.settings", key, { from: inst.settings, to: parsed.data });
    return storeAppOrFail(tx, ctx.tenantId, key);
  });
  await invalidateCache(rt, ctx, { type: "markets_changed" });
  return result;
}
