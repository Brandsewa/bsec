/**
 * Store-side AI access administration (ADR-050): the master switch with its consent, the permission matrix, connections and usage.
 * Every function checks `ai.manage` (owner and admin; never a support session), runs in `withTenant`, and writes `audit_logs`.
 */
import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, hasPermission, type StorePermission, type TenantContext } from "../context.ts";
import { aiAccessEntitled, aiFlagEnabled } from "./access.ts";
import { AI_CONSENT_TEXT, AI_CONSENT_VERSION } from "./consent.ts";
import { AI_ACTIONS, AI_CELLS, AI_RESOURCES, isCellAllowed, normalizeMatrix, readOnlyMatrix, storePermissionFor, type AiMatrix, type AiResource } from "./matrix.ts";
import { listAgentCalls, type AgentCallEntry } from "./call-log.ts";
import { getAuthorizationRequestView, type AuthorizationRequestView } from "./oauth.ts";
import { readAiUsage, type AiUsage } from "./limits.ts";
import { revokeConnectionTokens } from "./tokens.ts";

function fail(kind: "Conflict" | "Bad Request" | "Not Found" | "Forbidden", message: string): never {
  throw new Error(`${kind}: ${message}`);
}

async function audit(tx: Db, ctx: TenantContext, action: string, targetId: string, diff: Record<string, unknown>): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType: "ai_access",
    targetId,
    diff,
  });
}

export interface AiSettingsView {
  /** The plan includes AI access. */
  entitled: boolean;
  /** Super Admin has not switched AI access off for this store. */
  available: boolean;
  enabled: boolean;
  matrix: AiMatrix;
  allowPublishing: boolean;
  cells: typeof AI_CELLS;
  consent: { currentVersion: number; acceptedVersion: number | null; acceptedAt: string | null; accepted: boolean; text: typeof AI_CONSENT_TEXT };
}

export async function getAiSettings(rt: Runtime, ctx: TenantContext): Promise<AiSettingsView> {
  assertPermission(ctx, "ai.manage");
  const db = rt._db.db;
  const [entitled, available] = await Promise.all([aiAccessEntitled(db, ctx.tenantId), aiFlagEnabled(db, ctx.tenantId)]);
  const row = await withTenant(db, ctx.tenantId, async (tx) => {
    const [r] = await tx.select().from(schema.storeAiSettings).where(eq(schema.storeAiSettings.tenantId, ctx.tenantId)).limit(1);
    return r;
  });
  const acceptedVersion = row?.consentVersion ?? null;
  return {
    entitled,
    available,
    enabled: row?.enabled ?? false,
    matrix: normalizeMatrix(row?.matrix),
    allowPublishing: row?.allowPublishing ?? false,
    cells: AI_CELLS,
    consent: {
      currentVersion: AI_CONSENT_VERSION,
      acceptedVersion,
      acceptedAt: row?.consentAt?.toISOString() ?? null,
      accepted: acceptedVersion === AI_CONSENT_VERSION,
      text: AI_CONSENT_TEXT,
    },
  };
}

export interface UpdateAiSettingsInput {
  enabled?: boolean | undefined;
  /** The merchant ticked the box on the current wording. Required to switch on, or to re-accept after a new version. */
  acceptConsentVersion?: number | undefined;
  matrix?: unknown;
  readOnlyPreset?: boolean | undefined;
  allowPublishing?: boolean | undefined;
}

export async function updateAiSettings(rt: Runtime, ctx: TenantContext, input: UpdateAiSettingsInput): Promise<AiSettingsView> {
  assertPermission(ctx, "ai.manage");
  if (ctx.actor.type !== "staff") fail("Forbidden", "Only a signed-in store user can change AI access");
  const userId = ctx.actor.userId;
  const db = rt._db.db;
  if (!(await aiAccessEntitled(db, ctx.tenantId))) fail("Forbidden", "AI access is available on the Growth plan and above. Upgrade your plan to use it");

  await withTenant(db, ctx.tenantId, async (tx) => {
    const [before] = await tx.select().from(schema.storeAiSettings).where(eq(schema.storeAiSettings.tenantId, ctx.tenantId)).limit(1);
    const wasEnabled = before?.enabled ?? false;
    const beforeMatrix = normalizeMatrix(before?.matrix);
    const patch: Partial<typeof schema.storeAiSettings.$inferInsert> = { updatedAt: new Date(), updatedBy: userId };

    const accepting = input.acceptConsentVersion !== undefined;
    if (accepting && input.acceptConsentVersion !== AI_CONSENT_VERSION) fail("Conflict", "The AI access terms changed. Reload the page and read them again");
    if (input.enabled === true && !wasEnabled && !accepting) fail("Bad Request", "Accept the AI access terms to turn on AI access");

    if (accepting) {
      patch.consentVersion = AI_CONSENT_VERSION;
      patch.consentAt = new Date();
      patch.consentByUserId = userId;
    }
    if (input.enabled !== undefined) {
      patch.enabled = input.enabled;
      // Turning off and on again asks again (docs/MCP-PLAN.md section 3.3).
      if (input.enabled === false) {
        patch.consentVersion = null;
        patch.consentAt = null;
        patch.consentByUserId = null;
      }
    }
    let nextMatrix: AiMatrix | undefined;
    if (input.readOnlyPreset) nextMatrix = readOnlyMatrix();
    else if (input.matrix !== undefined) nextMatrix = normalizeMatrix(input.matrix);
    if (nextMatrix) patch.matrix = nextMatrix;
    if (input.allowPublishing !== undefined) patch.allowPublishing = input.allowPublishing;

    await tx
      .insert(schema.storeAiSettings)
      .values({ tenantId: ctx.tenantId, ...patch })
      .onConflictDoUpdate({ target: schema.storeAiSettings.tenantId, set: patch });

    if (accepting) await audit(tx, ctx, "ai.consent.accepted", ctx.tenantId, { version: AI_CONSENT_VERSION });
    if (input.enabled !== undefined && input.enabled !== wasEnabled) await audit(tx, ctx, input.enabled ? "ai.enabled" : "ai.disabled", ctx.tenantId, {});
    if (nextMatrix) await audit(tx, ctx, "ai.matrix.updated", ctx.tenantId, { before: beforeMatrix, after: nextMatrix });
    if (input.allowPublishing !== undefined && input.allowPublishing !== (before?.allowPublishing ?? false)) {
      await audit(tx, ctx, "ai.publishing.updated", ctx.tenantId, { allowPublishing: input.allowPublishing });
    }
  });
  return getAiSettings(rt, ctx);
}

export interface AiConnectionView {
  id: string;
  clientName: string;
  protocol: string;
  status: string;
  approvedBy: { name: string; email: string };
  connectedAt: string;
  lastUsedAt: string | null;
  paused: boolean;
}

export async function listAiConnections(rt: Runtime, ctx: TenantContext): Promise<AiConnectionView[]> {
  assertPermission(ctx, "ai.manage");
  const rows = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx
      .select({ c: schema.agentConnections, name: schema.users.name, email: schema.users.email })
      .from(schema.agentConnections)
      .innerJoin(schema.users, eq(schema.users.id, schema.agentConnections.userId))
      .where(and(eq(schema.agentConnections.tenantId, ctx.tenantId), eq(schema.agentConnections.status, "active")))
      .orderBy(desc(schema.agentConnections.createdAt)),
  );
  return rows.map(({ c, name, email }) => ({
    id: c.id,
    clientName: c.clientName,
    protocol: c.protocol,
    status: c.status,
    approvedBy: { name, email },
    connectedAt: c.createdAt.toISOString(),
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    paused: !!c.pausedUntil && c.pausedUntil.getTime() > Date.now(),
  }));
}

/** Disconnects an AI app at once: the connection is revoked and every token it holds stops working. */
export async function revokeAiConnection(rt: Runtime, ctx: TenantContext, connectionId: string): Promise<{ revoked: true }> {
  assertPermission(ctx, "ai.manage");
  if (ctx.actor.type !== "staff") fail("Forbidden", "Only a signed-in store user can disconnect an AI app");
  const userId = ctx.actor.userId;
  const db = rt._db.db;
  await withTenant(db, ctx.tenantId, async (tx) => {
    const [c] = await tx
      .update(schema.agentConnections)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy: userId })
      .where(and(eq(schema.agentConnections.tenantId, ctx.tenantId), eq(schema.agentConnections.id, connectionId), eq(schema.agentConnections.status, "active")))
      .returning({ clientName: schema.agentConnections.clientName });
    if (!c) fail("Not Found", "That connection was not found");
    await audit(tx, ctx, "ai.connection.revoked", connectionId, { clientName: c.clientName });
  });
  await revokeConnectionTokens(db, ctx.tenantId, connectionId);
  return { revoked: true };
}

export async function getAiUsage(rt: Runtime, ctx: TenantContext): Promise<AiUsage> {
  assertPermission(ctx, "ai.manage");
  const tz = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [s] = await tx.select({ timezone: schema.storeSettings.timezone }).from(schema.storeSettings).where(eq(schema.storeSettings.tenantId, ctx.tenantId)).limit(1);
    return s?.timezone ?? "Asia/Kolkata";
  });
  return readAiUsage(rt._db.db, ctx.tenantId, tz);
}

const ABILITY_TEXT: Record<string, string> = {
  "products.read": "View products, prices and stock",
  "products.write": "Create and edit products (new products are saved as drafts)",
  "products.delete": "Archive products (they can be restored)",
  "categories.read": "View categories",
  "categories.write": "Create and edit categories",
  "categories.delete": "Delete categories that have no products and no sub-categories",
  "collections.read": "View collections",
  "collections.write": "Create and edit collections and choose their products",
  "collections.delete": "Delete collections that are not published",
  "blog.read": "View blog posts and blog categories",
  "blog.write": "Write and edit blog posts and blog categories (new posts are saved as drafts)",
  "blog.delete": "Delete blog posts that are not published, and blog categories",
  "pages.read": "View website pages, their text and links, and the menus",
  "pages.write": "Edit website page text, links and sections (changes are saved as drafts) and edit menus",
  "pages.delete": "Delete website pages that are not published, and menus",
  "redirects.read": "View the redirect manager",
  "redirects.write": "Add and edit redirects",
  "redirects.delete": "Delete redirects",
  "customers.read": "View customers, including names, email addresses, phone numbers and addresses",
  "orders.read": "View orders",
  "analytics.read": "View sales reports",
  "finance.read": "View profit and loss and expenses",
};

/** What the approve screen tells the merchant: the live matrix in plain words, cut down to what the approving user may actually do. */
function describeAbilities(matrix: AiMatrix, allowPublishing: boolean, permissions: readonly string[]): { abilities: string[]; refusals: string[] } {
  const abilities: string[] = [];
  for (const resource of AI_RESOURCES) {
    for (const action of AI_ACTIONS) {
      if (!isCellAllowed(matrix, resource, action)) continue;
      if (!hasPermission(permissions, storePermissionFor(resource, action) as StorePermission)) continue;
      const line = ABILITY_TEXT[`${resource}.${action}`];
      if (line) abilities.push(line);
    }
  }
  const can = (r: AiResource) => isCellAllowed(matrix, r, "write") && hasPermission(permissions, storePermissionFor(r, "write") as StorePermission);
  const canWriteCatalog = (can("products") || can("collections") || can("blog") || can("pages")) && allowPublishing;
  if (canWriteCatalog) abilities.push("Publish products, collections, blog posts and pages (make them visible to shoppers)");
  const refusals = ["Change store settings, payments or staff", "Move money or edit the books", "Delete anything permanently", "Send emails or messages to customers"];
  if (!canWriteCatalog) refusals.unshift("Publish products, collections, blog posts or pages");
  return { abilities, refusals };
}

export interface AiAuthorizationView extends AuthorizationRequestView {
  store: { entitled: boolean; available: boolean; enabled: boolean; consentAccepted: boolean; abilities: string[]; refusals: string[] };
}

/** The authorize screen's data: who is asking, and what the chosen store would let them do. Nothing is created here. */
export async function getAiAuthorization(rt: Runtime, ctx: TenantContext, requestId: string): Promise<AiAuthorizationView> {
  assertPermission(ctx, "ai.manage");
  const view = await getAuthorizationRequestView(rt, requestId);
  const settings = await getAiSettings(rt, ctx);
  const { abilities, refusals } = describeAbilities(settings.matrix, settings.allowPublishing, ctx.permissions);
  return {
    ...view,
    store: { entitled: settings.entitled, available: settings.available, enabled: settings.enabled, consentAccepted: settings.consent.accepted, abilities, refusals },
  };
}

export async function listAiActivity(rt: Runtime, ctx: TenantContext, limit: number): Promise<AgentCallEntry[]> {
  assertPermission(ctx, "ai.manage");
  return listAgentCalls(rt._db.db, ctx.tenantId, limit);
}

export interface AiChangeEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  client: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

/** Changes made by AI apps (from the audit log), newest first, with the values before and after. */
export async function listAiChanges(rt: Runtime, ctx: TenantContext, limit: number): Promise<AiChangeEntry[]> {
  assertPermission(ctx, "ai.manage");
  const rows = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, ctx.tenantId), eq(schema.auditLogs.actorType, "agent")))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(Math.min(limit, 100)),
  );
  return rows.map((r) => {
    const d = (r.diff ?? {}) as { client?: string; before?: unknown; after?: unknown };
    return { id: r.id, action: r.action, targetType: r.targetType, targetId: r.targetId, client: d.client ?? null, before: d.before ?? null, after: d.after ?? null, createdAt: r.createdAt.toISOString() };
  });
}
