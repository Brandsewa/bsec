/**
 * Store redirects (ADR-051): list, create, change, delete and bulk-import the old addresses a store keeps alive, plus the read the
 * storefront gate uses. Every change checks `content.write`, runs in `withTenant`, writes `audit_logs` and clears the in-process
 * lookup. Slug changes elsewhere record automatic redirects through `recordAutoRedirect` in the same transaction.
 */
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import {
  MAX_REDIRECTS_PER_STORE,
  normalizeFromPath,
  normalizeToPath,
  parseStatus,
  reservedReason,
  targetAsStorePath,
  wouldLoop,
  type RedirectStatus,
} from "./paths.ts";

function fail(kind: "Conflict" | "Bad Request" | "Not Found", message: string): never {
  throw new Error(`${kind}: ${message}`);
}

export interface RedirectView {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  source: "manual" | "import" | "auto";
  createdAt: string;
}

const view = (r: typeof schema.tenantRedirects.$inferSelect): RedirectView => ({
  id: r.id,
  fromPath: r.fromPath,
  toPath: r.toPath,
  statusCode: r.statusCode,
  source: r.source as RedirectView["source"],
  createdAt: r.createdAt.toISOString(),
});

async function audit(tx: Db, ctx: TenantContext, action: string, targetId: string, diff: Record<string, unknown>): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType: "redirect",
    targetId,
    diff,
  });
}

const actorId = (ctx: TenantContext): string | null => (ctx.actor.type === "staff" ? ctx.actor.userId : null);

/* ------------------------------ storefront read ------------------------------ */

/** What the storefront gate keeps per store: lower-cased source path to its target. Short-lived, like the market prefixes. */
const MAP_TTL_MS = 30_000;
const mapCache = new Map<string, { at: number; map: Map<string, { to: string; status: number }> }>();

/** Drops this process's copy of a store's redirects so the next request reads the new list (other processes catch up in 30 s). */
export function clearRedirectCache(tenantId: string): void {
  mapCache.delete(tenantId);
}

async function loadMap(rt: Runtime, tenantId: string): Promise<Map<string, { to: string; status: number }>> {
  const hit = mapCache.get(tenantId);
  if (hit && Date.now() - hit.at < MAP_TTL_MS) return hit.map;
  const rows = await withTenant(rt._db.db, tenantId, (tx) =>
    tx
      .select({ from: schema.tenantRedirects.fromPath, to: schema.tenantRedirects.toPath, status: schema.tenantRedirects.statusCode })
      .from(schema.tenantRedirects)
      .where(eq(schema.tenantRedirects.tenantId, tenantId))
      .limit(MAX_REDIRECTS_PER_STORE),
  );
  const map = new Map(rows.map((r) => [r.from.toLowerCase(), { to: r.to, status: r.status }]));
  mapCache.set(tenantId, { at: Date.now(), map });
  return map;
}

/** The redirect for a request path (market prefix already removed), or null. Called by the storefront gate on every request. */
export async function findStoreRedirect(rt: Runtime, tenantId: string, path: string): Promise<{ to: string; status: number } | null> {
  const map = await loadMap(rt, tenantId);
  if (map.size === 0) return null;
  const key = (path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path).toLowerCase();
  return map.get(key) ?? null;
}

/* ---------------------------------- admin ---------------------------------- */

export async function listRedirects(
  rt: Runtime,
  ctx: TenantContext,
  opts: { search?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ items: RedirectView[]; total: number; limit: number }> {
  assertPermission(ctx, "content.write");
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  const term = opts.search?.trim();
  const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const where = and(
      eq(schema.tenantRedirects.tenantId, ctx.tenantId),
      like ? or(ilike(schema.tenantRedirects.fromPath, like), ilike(schema.tenantRedirects.toPath, like)) : undefined,
    );
    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(schema.tenantRedirects)
        .where(where)
        .orderBy(desc(schema.tenantRedirects.createdAt), asc(schema.tenantRedirects.fromPath))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      tx.select({ n: count() }).from(schema.tenantRedirects).where(where),
    ]);
    return { items: rows.map(view), total: Number(totals[0]?.n ?? 0), limit: MAX_REDIRECTS_PER_STORE };
  });
}

/** Every existing source path and its target in the store, for loop checks. */
async function existingMap(tx: Db, tenantId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ from: schema.tenantRedirects.fromPath, to: schema.tenantRedirects.toPath })
    .from(schema.tenantRedirects)
    .where(eq(schema.tenantRedirects.tenantId, tenantId))
    .limit(MAX_REDIRECTS_PER_STORE);
  return new Map(rows.map((r) => [r.from.toLowerCase(), r.to]));
}

interface Checked {
  from: string;
  to: string;
  status: RedirectStatus;
}

/** Normalises and validates one redirect against the store's existing ones. `ignoreFrom` is the row being edited. */
function check(input: { from: string; to: string; status?: unknown }, map: ReadonlyMap<string, string>, ignoreFrom?: string): Checked {
  const from = normalizeFromPath(input.from);
  if (!from) fail("Bad Request", `"${input.from}" is not a valid address on the store. Use a path such as /old-page.`);
  const reserved = reservedReason(from);
  if (reserved) fail("Bad Request", reserved);
  const to = normalizeToPath(input.to);
  if (!to) fail("Bad Request", `"${input.to}" is not a valid destination. Use a path such as /new-page or a full https:// address.`);
  const status = input.status === undefined || input.status === "" || input.status === null ? 308 : parseStatus(input.status);
  if (!status) fail("Bad Request", "The status must be 301, 302, 307 or 308.");
  const own = targetAsStorePath(to);
  if (own && own.toLowerCase() === from.toLowerCase()) fail("Bad Request", "A redirect cannot point to itself.");
  const others = new Map(map);
  if (ignoreFrom) others.delete(ignoreFrom.toLowerCase());
  if (wouldLoop(from, to, others)) fail("Bad Request", `Redirecting ${from} to ${to} would loop or bounce visitors through too many redirects.`);
  return { from, to, status };
}

export async function createRedirect(
  rt: Runtime,
  ctx: TenantContext,
  input: { from: string; to: string; status?: number | undefined },
): Promise<RedirectView> {
  assertPermission(ctx, "content.write");
  const created = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const map = await existingMap(tx, ctx.tenantId);
    if (map.size >= MAX_REDIRECTS_PER_STORE) fail("Conflict", `A store can have up to ${MAX_REDIRECTS_PER_STORE} redirects. Delete some first.`);
    const c = check(input, map);
    if (map.has(c.from.toLowerCase())) fail("Conflict", `${c.from} already redirects somewhere. Edit that redirect instead.`);
    const [row] = await tx
      .insert(schema.tenantRedirects)
      .values({ tenantId: ctx.tenantId, fromPath: c.from, toPath: c.to, statusCode: c.status, source: "manual", createdBy: actorId(ctx) })
      .returning();
    if (!row) fail("Conflict", "The redirect could not be saved.");
    await audit(tx, ctx, "redirect.created", row.id, { from: c.from, to: c.to, status: c.status });
    return row;
  });
  clearRedirectCache(ctx.tenantId);
  return view(created);
}

export async function updateRedirect(
  rt: Runtime,
  ctx: TenantContext,
  id: string,
  input: { from?: string | undefined; to?: string | undefined; status?: number | undefined },
): Promise<RedirectView> {
  assertPermission(ctx, "content.write");
  const updated = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.tenantRedirects)
      .where(and(eq(schema.tenantRedirects.tenantId, ctx.tenantId), eq(schema.tenantRedirects.id, id)));
    if (!current) fail("Not Found", "Redirect not found.");
    const map = await existingMap(tx, ctx.tenantId);
    const c = check({ from: input.from ?? current.fromPath, to: input.to ?? current.toPath, status: input.status ?? current.statusCode }, map, current.fromPath);
    if (c.from.toLowerCase() !== current.fromPath.toLowerCase() && map.has(c.from.toLowerCase())) fail("Conflict", `${c.from} already redirects somewhere.`);
    const [row] = await tx
      .update(schema.tenantRedirects)
      .set({ fromPath: c.from, toPath: c.to, statusCode: c.status })
      .where(and(eq(schema.tenantRedirects.tenantId, ctx.tenantId), eq(schema.tenantRedirects.id, id)))
      .returning();
    if (!row) fail("Not Found", "Redirect not found.");
    await audit(tx, ctx, "redirect.updated", id, {
      before: { from: current.fromPath, to: current.toPath, status: current.statusCode },
      after: { from: c.from, to: c.to, status: c.status },
    });
    return row;
  });
  clearRedirectCache(ctx.tenantId);
  return view(updated);
}

export async function deleteRedirect(rt: Runtime, ctx: TenantContext, id: string): Promise<{ success: true }> {
  assertPermission(ctx, "content.write");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .delete(schema.tenantRedirects)
      .where(and(eq(schema.tenantRedirects.tenantId, ctx.tenantId), eq(schema.tenantRedirects.id, id)))
      .returning();
    if (!row) fail("Not Found", "Redirect not found.");
    await audit(tx, ctx, "redirect.deleted", id, { from: row.fromPath, to: row.toPath });
  });
  clearRedirectCache(ctx.tenantId);
  return { success: true };
}

export interface RedirectImportResult {
  created: number;
  skipped: number;
  results: Array<{ row: number; from: string; ok: boolean; message?: string }>;
}

/** Up to 500 rows per call. A bad row is reported and skipped; the good rows are saved. One audit row summarises the import. */
export async function importRedirects(
  rt: Runtime,
  ctx: TenantContext,
  rows: Array<{ from: string; to: string; status?: number | string | undefined }>,
): Promise<RedirectImportResult> {
  assertPermission(ctx, "content.write");
  if (rows.length === 0) fail("Bad Request", "There are no rows to import.");
  if (rows.length > 500) fail("Bad Request", "Import up to 500 redirects at a time.");
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const map = await existingMap(tx, ctx.tenantId);
    const out: RedirectImportResult = { created: 0, skipped: 0, results: [] };
    for (const [i, input] of rows.entries()) {
      const n = i + 1;
      try {
        if (map.size >= MAX_REDIRECTS_PER_STORE) fail("Conflict", `A store can have up to ${MAX_REDIRECTS_PER_STORE} redirects.`);
        const c = check(input, map);
        if (map.has(c.from.toLowerCase())) fail("Conflict", `${c.from} already redirects somewhere.`);
        await tx
          .insert(schema.tenantRedirects)
          .values({ tenantId: ctx.tenantId, fromPath: c.from, toPath: c.to, statusCode: c.status, source: "import", createdBy: actorId(ctx) });
        map.set(c.from.toLowerCase(), c.to);
        out.created++;
        out.results.push({ row: n, from: c.from, ok: true });
      } catch (e) {
        out.skipped++;
        out.results.push({
          row: n,
          from: String(input.from ?? ""),
          ok: false,
          message: (e instanceof Error ? e.message : "Could not import").replace(/^(Bad Request|Conflict|Not Found): /, ""),
        });
      }
    }
    await audit(tx, ctx, "redirect.imported", ctx.tenantId, { created: out.created, skipped: out.skipped });
    return out;
  });
  clearRedirectCache(ctx.tenantId);
  return result;
}

/* ------------------------- automatic redirects (slug changes) ------------------------- */

/**
 * Called inside the transaction that changes a product, collection, category or page address: the old address now redirects to
 * the new one. A redirect that pointed at the old address is re-pointed (no chains), and a redirect that sat on the new address
 * is removed (a page lives there now). A manual redirect already on the old address is left alone. Never throws for a
 * reserved or looping pair: an automatic redirect is a convenience, not a reason to fail a rename.
 */
export async function recordAutoRedirect(tx: Db, ctx: TenantContext, fromPath: string, toPath: string): Promise<void> {
  const from = normalizeFromPath(fromPath);
  const to = normalizeFromPath(toPath);
  if (!from || !to || from.toLowerCase() === to.toLowerCase() || reservedReason(from)) return;
  await tx.delete(schema.tenantRedirects).where(and(eq(schema.tenantRedirects.tenantId, ctx.tenantId), sql`${schema.tenantRedirects.fromPath} = ${to}`));
  await tx
    .update(schema.tenantRedirects)
    .set({ toPath: to })
    .where(and(eq(schema.tenantRedirects.tenantId, ctx.tenantId), sql`${schema.tenantRedirects.toPath} = ${from}`));
  const [total] = await tx.select({ n: count() }).from(schema.tenantRedirects).where(eq(schema.tenantRedirects.tenantId, ctx.tenantId));
  if (Number(total?.n ?? 0) >= MAX_REDIRECTS_PER_STORE) return;
  await tx
    .insert(schema.tenantRedirects)
    .values({ tenantId: ctx.tenantId, fromPath: from, toPath: to, statusCode: 308, source: "auto", createdBy: actorId(ctx) })
    .onConflictDoNothing({ target: [schema.tenantRedirects.tenantId, schema.tenantRedirects.fromPath] });
  clearRedirectCache(ctx.tenantId);
}
