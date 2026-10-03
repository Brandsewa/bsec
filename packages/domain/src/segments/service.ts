import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Db, schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { checkRateLimit, RateLimitExceededError } from "../system/rate-limit.ts";
import { customerMetricsSql } from "../customers/metrics.ts";
import { parseSegmentRules, rulesReferenceSegments, SegmentRuleError, type SegmentRules } from "./rules.ts";
import { segmentMemberSubquery, type SegmentRefResolver } from "./compile.ts";

/**
 * Segment services (Customers Segments PLAN §4). Reads check `customers.read`, mutations
 * `customers.write`; every mutation writes audit_logs. At most 20 segments per store
 * (owner decision 2026-10-03). Segments group and export only — nothing sends.
 */

export const SEGMENTS_LIMIT_PER_STORE = 20;
export const SEGMENT_ADD_CAP = 5000;
/** Live previews run with a 5 s statement timeout so a hostile rule set cannot tie up the pool. */
export const SEGMENT_PREVIEW_TIMEOUT_MS = 5000;

export interface SegmentRecord {
  id: string;
  name: string;
  description: string | null;
  kind: "manual" | "automatic";
  rules: SegmentRules | null;
  isPreset: boolean;
  memberCount: number;
  countedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const segmentColumns = {
  id: schema.customerSegments.id,
  name: schema.customerSegments.name,
  description: schema.customerSegments.description,
  kind: schema.customerSegments.kind,
  rules: schema.customerSegments.rules,
  isPreset: schema.customerSegments.isPreset,
  memberCount: schema.customerSegments.memberCount,
  countedAt: schema.customerSegments.countedAt,
  createdAt: schema.customerSegments.createdAt,
  updatedAt: schema.customerSegments.updatedAt,
};

type SegmentRow = {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  rules: unknown;
  isPreset: boolean;
  memberCount: number;
  countedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const toRecord = (r: SegmentRow): SegmentRecord => ({
  id: r.id,
  name: r.name,
  description: r.description,
  kind: r.kind as "manual" | "automatic",
  rules: (r.rules as SegmentRules | null) ?? null,
  isPreset: r.isPreset,
  memberCount: r.memberCount,
  countedAt: r.countedAt ? r.countedAt.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** Loads every segment of the store (≤ 20) for in_segment resolution; sync and cycle-safe. */
async function loadSegmentMap(tx: Db, tenantId: string): Promise<Map<string, { kind: "manual" | "automatic"; rules: SegmentRules | null; name: string }>> {
  const rows = await tx
    .select({ id: schema.customerSegments.id, kind: schema.customerSegments.kind, rules: schema.customerSegments.rules, name: schema.customerSegments.name })
    .from(schema.customerSegments)
    .where(eq(schema.customerSegments.tenantId, tenantId));
  return new Map(
    rows.map((r) => [r.id, { kind: r.kind as "manual" | "automatic", rules: (r.rules as SegmentRules | null) ?? null, name: r.name }]),
  );
}

/** The in_segment resolver: only segments of this store resolve; referenced automatic segments may not use in_segment (depth 1, PLAN §3). */
function makeResolver(map: Map<string, { kind: "manual" | "automatic"; rules: SegmentRules | null; name: string }>): SegmentRefResolver {
  return (segmentId) => {
    const ref = map.get(segmentId);
    if (!ref) throw new SegmentRuleError(`Referenced segment not found in this store: ${segmentId}`);
    if (ref.kind === "automatic" && ref.rules && rulesReferenceSegments(ref.rules)) {
      throw new SegmentRuleError(`Referenced segment "${ref.name}" uses an in_segment condition; only one level is allowed`);
    }
    return { kind: ref.kind, rules: ref.rules };
  };
}

/** Live member count of one segment (manual rows joined to live customers, or the compiled query). */
async function countSegmentMembers(tx: Db, tenantId: string, segment: { id: string; kind: string; rules: unknown }, map: Map<string, { kind: "manual" | "automatic"; rules: SegmentRules | null; name: string }>): Promise<number> {
  if (segment.kind === "manual") {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.customerSegmentMembers)
      .innerJoin(schema.customers, and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, schema.customerSegmentMembers.customerId)))
      .where(and(eq(schema.customerSegmentMembers.tenantId, tenantId), eq(schema.customerSegmentMembers.segmentId, segment.id), isNull(schema.customers.deletedAt)));
    return row?.n ?? 0;
  }
  const sub = segmentMemberSubquery(tenantId, parseSegmentRules(segment.rules), makeResolver(map));
  const res = await tx.execute(sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${schema.customers} WHERE ${schema.customers.tenantId} = ${tenantId} AND ${schema.customers.deletedAt} IS NULL AND ${schema.customers.id} IN ${sub}) t`);
  return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
}

async function setSegmentCount(tx: Db, tenantId: string, segmentId: string, memberCount: number): Promise<Date> {
  const countedAt = new Date();
  await tx
    .update(schema.customerSegments)
    .set({ memberCount, countedAt, updatedAt: new Date() })
    .where(and(eq(schema.customerSegments.tenantId, tenantId), eq(schema.customerSegments.id, segmentId)));
  return countedAt;
}

async function touchCount(rt: Runtime, ctx: TenantContext, segmentId: string): Promise<{ memberCount: number; countedAt: string }> {
  const db = rt._db.db;
  return await withTenant(db, ctx.tenantId, async (tx) => {
    const map = await loadSegmentMap(tx, ctx.tenantId);
    const seg = map.get(segmentId);
    if (!seg) throw new Error(`Segment not found: ${segmentId}`);
    const [row] = await tx
      .select({ kind: schema.customerSegments.kind, rules: schema.customerSegments.rules })
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, segmentId)))
      .limit(1);
    if (!row) throw new Error(`Segment not found: ${segmentId}`);
    const count = await countSegmentMembers(tx, ctx.tenantId, { id: segmentId, kind: row.kind, rules: row.rules }, map);
    const countedAt = await setSegmentCount(tx, ctx.tenantId, segmentId, count);
    return { memberCount: count, countedAt: countedAt.toISOString() };
  });
}

export async function listSegments(rt: Runtime, ctx: TenantContext, input: { kind?: "manual" | "automatic" | undefined; limit?: number | undefined; offset?: number | undefined } = {}) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [eq(schema.customerSegments.tenantId, ctx.tenantId)];
    if (input.kind) conditions.push(eq(schema.customerSegments.kind, input.kind));
    const where = and(...conditions);

    const [countRow] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.customerSegments).where(where);
    const rows = await tx
      .select(segmentColumns)
      .from(schema.customerSegments)
      .where(where)
      .orderBy(desc(schema.customerSegments.createdAt), desc(schema.customerSegments.id))
      .limit(limit)
      .offset(offset);
    return { items: rows.map(toRecord), total: countRow?.n ?? 0 };
  });
}

export async function getSegment(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select(segmentColumns)
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.id)))
      .limit(1);
    if (!row) throw new Error(`Segment not found: ${input.id}`);
    return toRecord(row);
  });
}

export interface CreateSegmentInput {
  name: string;
  description?: string | undefined;
  kind: "manual" | "automatic";
  rules?: unknown;
  isPreset?: boolean | undefined;
}

export async function createSegment(rt: Runtime, ctx: TenantContext, input: CreateSegmentInput) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;
  const name = input.name.trim();
  if (!name) throw new Error("A segment needs a name");
  if (name.length > 100) throw new Error("A segment name can be at most 100 characters");
  if (input.description && input.description.length > 200) throw new Error("A description can be at most 200 characters");
  const rules = input.kind === "automatic" ? parseSegmentRules(input.rules) : null;
  if (input.kind === "automatic" && !rules) throw new Error("An automatic segment needs conditions");
  const actorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [countRow] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.customerSegments).where(eq(schema.customerSegments.tenantId, ctx.tenantId));
    if ((countRow?.n ?? 0) >= SEGMENTS_LIMIT_PER_STORE) {
      throw new Error(`This store already has the maximum of ${SEGMENTS_LIMIT_PER_STORE} segments. Delete one to create a new segment.`);
    }

    const [nameTaken] = await tx
      .select({ id: schema.customerSegments.id })
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), sql`lower(${schema.customerSegments.name}) = lower(${name})`))
      .limit(1);
    if (nameTaken) throw new Error(`A segment named "${name}" already exists`);

    const map = await loadSegmentMap(tx, ctx.tenantId);
    let memberCount = 0;
    let countedAt: Date | null = null;
    if (rules) {
      // in_segment targets must exist in this store (and be one level deep); the resolver throws otherwise.
      const resolver = makeResolver(map);
      for (const c of rules.conditions) {
        if (c.field === "in_segment") resolver(c.value as string);
      }
      memberCount = await countSegmentMembers(tx, ctx.tenantId, { id: "", kind: "automatic", rules }, map);
      countedAt = new Date();
    }

    const [row] = await tx
      .insert(schema.customerSegments)
      .values({
        tenantId: ctx.tenantId,
        name,
        description: input.description?.trim() || null,
        kind: input.kind,
        rules,
        isPreset: input.isPreset ?? false,
        memberCount,
        countedAt,
        createdBy: actorId,
      })
      .returning();
    if (!row) throw new Error("Failed to create segment");

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId,
      action: "segment.created",
      targetType: "segment",
      targetId: row.id,
      diff: { name, kind: input.kind, ...(input.isPreset ? { preset: true } : {}) },
    });

    return toRecord(row as SegmentRow);
  });
}

export interface UpdateSegmentInput {
  id: string;
  name?: string | undefined;
  description?: string | null | undefined;
  rules?: unknown;
}

export async function updateSegment(rt: Runtime, ctx: TenantContext, input: UpdateSegmentInput) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;
  const actorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select(segmentColumns)
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.id)))
      .limit(1);
    if (!existing) throw new Error(`Segment not found: ${input.id}`);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const diff: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("A segment needs a name");
      if (name.length > 100) throw new Error("A segment name can be at most 100 characters");
      if (name.toLowerCase() !== existing.name.toLowerCase()) {
        const [nameTaken] = await tx
          .select({ id: schema.customerSegments.id })
          .from(schema.customerSegments)
          .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), sql`lower(${schema.customerSegments.name}) = lower(${name})`, sql`${schema.customerSegments.id} <> ${input.id}`))
          .limit(1);
        if (nameTaken) throw new Error(`A segment named "${name}" already exists`);
        updates.name = name;
        diff.name = { from: existing.name, to: name };
      }
    }
    if (input.description !== undefined) {
      const description = input.description?.trim() || null;
      if (description && description.length > 200) throw new Error("A description can be at most 200 characters");
      if (description !== existing.description) {
        updates.description = description;
        diff.description = true;
      }
    }

    let rules: SegmentRules | null = (existing.rules as SegmentRules | null) ?? null;
    let rulesChanged = false;
    if (input.rules !== undefined) {
      if (existing.kind !== "automatic") {
        throw new Error("Only automatic segments have conditions");
      }
      rules = parseSegmentRules(input.rules);
      rulesChanged = JSON.stringify(rules) !== JSON.stringify(existing.rules ?? null);
      if (rulesChanged) {
        updates.rules = rules;
        diff.rules = true;
      }
    }

    await tx.update(schema.customerSegments).set(updates).where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.id)));

    if (Object.keys(diff).length > 0) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId,
        action: "segment.updated",
        targetType: "segment",
        targetId: input.id,
        diff,
      });
    }

    // A rule change re-computes the count so the list is truthful right after an edit.
    if (rulesChanged && rules) {
      const map = await loadSegmentMap(tx, ctx.tenantId);
      const count = await countSegmentMembers(tx, ctx.tenantId, { id: input.id, kind: "automatic", rules }, map);
      const countedAt = await setSegmentCount(tx, ctx.tenantId, input.id, count);
      return { ...toRecord({ ...existing, rules, memberCount: count, countedAt, updatedAt: new Date() }), countedAt: countedAt.toISOString() };
    }

    const [fresh] = await tx
      .select(segmentColumns)
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.id)))
      .limit(1);
    if (!fresh) throw new Error(`Segment not found: ${input.id}`);
    return toRecord(fresh);
  });
}

export async function deleteSegment(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;
  const actorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.customerSegments.id, name: schema.customerSegments.name, kind: schema.customerSegments.kind })
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.id)))
      .limit(1);
    if (!existing) throw new Error(`Segment not found: ${input.id}`);

    // Refused while another automatic segment references it with in_segment (PLAN §4).
    const others = await tx
      .select({ id: schema.customerSegments.id, name: schema.customerSegments.name, rules: schema.customerSegments.rules })
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.kind, "automatic"), sql`${schema.customerSegments.id} <> ${input.id}`));
    for (const other of others) {
      const rules = other.rules as SegmentRules | null;
      if (rules?.conditions.some((c) => c.field === "in_segment" && c.value === input.id)) {
        throw new Error(`Cannot delete "${existing.name}": the segment "${other.name}" includes it as a condition. Remove that condition first.`);
      }
    }

    await tx.delete(schema.customerSegments).where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.id)));

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId,
      action: "segment.deleted",
      targetType: "segment",
      targetId: input.id,
      diff: { name: existing.name, kind: existing.kind },
    });

    return { success: true };
  });
}

export async function previewSegmentRules(rt: Runtime, ctx: TenantContext, input: { rules: unknown }) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;
  const rules = parseSegmentRules(input.rules);
  const actorId = ctx.actor.type === "staff" ? ctx.actor.userId : "anonymous";
  const limiter = await checkRateLimit(db, { key: `segment_preview:${ctx.tenantId}:${actorId}`, limit: 30, windowSeconds: 60 });
  if (!limiter.allowed) {
    throw new RateLimitExceededError("Too many previews in a minute. Wait a moment and try again.", limiter.retryAfter, 30, `segment_preview:${ctx.tenantId}:${actorId}`);
  }

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const map = await loadSegmentMap(tx, ctx.tenantId);
    const sub = segmentMemberSubquery(ctx.tenantId, rules, makeResolver(map), { allowInSegment: true });
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${Math.floor(SEGMENT_PREVIEW_TIMEOUT_MS)}`));
    try {
      const countRes = await tx.execute(sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${schema.customers} WHERE ${schema.customers.tenantId} = ${ctx.tenantId} AND ${schema.customers.deletedAt} IS NULL AND ${schema.customers.id} IN ${sub}) t`);
      const sampleRows = await tx
        .select({ id: schema.customers.id, name: schema.customers.name, email: schema.customers.email })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), isNull(schema.customers.deletedAt), sql`${schema.customers.id} IN ${sub}`))
        .orderBy(desc(schema.customers.createdAt))
        .limit(10);
      return {
        count: Number((countRes.rows[0] as { n: number } | undefined)?.n ?? 0),
        sample: sampleRows.map((r) => ({ id: r.id, name: r.name, email: r.email })),
      };
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "57014") {
        throw new Error("The preview took too long and was stopped. Try fewer or simpler conditions.", { cause: e });
      }
      throw e;
    }
  });
}

export interface SegmentMemberRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isGuest: boolean;
  ordersCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
  marketingState: string;
  tags: string[];
}

export async function listSegmentMembers(
  rt: Runtime,
  ctx: TenantContext,
  input: { segmentId: string; search?: string | undefined; sort?: "created_desc" | "name_asc" | "name_desc" | "spent_desc" | "orders_desc" | undefined; limit?: number | undefined; offset?: number | undefined },
) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [seg] = await tx
      .select({ id: schema.customerSegments.id, kind: schema.customerSegments.kind, rules: schema.customerSegments.rules })
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.segmentId)))
      .limit(1);
    if (!seg) throw new Error(`Segment not found: ${input.segmentId}`);

    const map = await loadSegmentMap(tx, ctx.tenantId);
    const membership =
      seg.kind === "manual"
        ? sql`(SELECT m.customer_id FROM ${schema.customerSegmentMembers} m WHERE m.tenant_id = ${ctx.tenantId} AND m.segment_id = ${seg.id})`
        : segmentMemberSubquery(ctx.tenantId, parseSegmentRules(seg.rules), makeResolver(map));

    const conditions = [
      eq(schema.customers.tenantId, ctx.tenantId),
      isNull(schema.customers.deletedAt),
      sql`${schema.customers.id} IN ${membership}`,
    ];
    if (input.search) {
      const like = `%${input.search}%`;
      conditions.push(sql`(${schema.customers.name} ILIKE ${like} OR ${schema.customers.email} ILIKE ${like} OR ${schema.customers.phone} ILIKE ${like})`);
    }
    const where = and(...conditions);

    const orderBy = {
      created_desc: [desc(schema.customers.createdAt), desc(schema.customers.id)],
      name_asc: [asc(schema.customers.name), asc(schema.customers.id)],
      name_desc: [desc(schema.customers.name), desc(schema.customers.id)],
      spent_desc: [desc(sql`metrics.total_spent`), desc(schema.customers.id)],
      orders_desc: [desc(sql`metrics.orders_count`), desc(schema.customers.id)],
    }[input.sort ?? "created_desc"];

    const [countRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.customers)
      .leftJoin(customerMetricsSql(ctx.tenantId), sql`true`)
      .where(where);
    const rows = await tx
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        phone: schema.customers.phone,
        isGuest: schema.customers.isGuest,
        ordersCount: sql<number>`metrics.orders_count`,
        totalSpent: sql<number>`metrics.total_spent`,
        lastOrderAt: sql<Date | null>`metrics.last_order_at`,
        marketingState: schema.customers.marketingState,
        tags: schema.customers.tags,
      })
      .from(schema.customers)
      .leftJoin(customerMetricsSql(ctx.tenantId), sql`true`)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        isGuest: r.isGuest,
        ordersCount: Number(r.ordersCount || 0),
        totalSpent: Number(r.totalSpent || 0),
        lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt).toISOString() : null,
        marketingState: r.marketingState,
        tags: r.tags,
      })),
      total: countRow?.n ?? 0,
    } satisfies { items: SegmentMemberRecord[]; total: number };
  });
}

export interface AddMembersResult {
  added: number;
  alreadyIn: number;
  notFound: string[];
}

export async function addCustomersToSegment(rt: Runtime, ctx: TenantContext, input: { segmentId: string; customerIds?: string[] | undefined; emails?: string[] | undefined }) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;
  const ids = [...new Set(input.customerIds ?? [])];
  const emails = [...new Set((input.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (ids.length + emails.length > SEGMENT_ADD_CAP) {
    throw new Error(`At most ${SEGMENT_ADD_CAP.toLocaleString("en-IN")} customers can be added at once`);
  }
  const actorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [seg] = await tx
      .select({ id: schema.customerSegments.id, kind: schema.customerSegments.kind, name: schema.customerSegments.name })
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.segmentId)))
      .limit(1);
    if (!seg) throw new Error(`Segment not found: ${input.segmentId}`);
    if (seg.kind !== "manual") throw new Error(`"${seg.name}" is automatic: its membership comes from the conditions and cannot be edited`);

    const notFound: string[] = [];
    const resolved = new Set<string>(ids);
    if (emails.length > 0) {
      const byEmail = await tx
        .select({ id: schema.customers.id, email: schema.customers.email })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), inArray(schema.customers.email, emails)));
      const known = new Map(byEmail.map((r) => [r.email.toLowerCase(), r.id]));
      for (const email of emails) {
        const id = known.get(email);
        if (id) resolved.add(id);
        else notFound.push(email);
      }
    }
    // Ids that do not exist in this store count as not found (cross-store ids never join).
    if (resolved.size > 0) {
      const knownIds = await tx
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), inArray(schema.customers.id, [...resolved])));
      const knownSet = new Set(knownIds.map((r) => r.id));
      for (const id of resolved) if (!knownSet.has(id)) notFound.push(id);
    }

    if (resolved.size > 0) {
      const existing = await tx
        .select({ customerId: schema.customerSegmentMembers.customerId })
        .from(schema.customerSegmentMembers)
        .where(and(eq(schema.customerSegmentMembers.tenantId, ctx.tenantId), eq(schema.customerSegmentMembers.segmentId, seg.id), inArray(schema.customerSegmentMembers.customerId, [...resolved])));
      const already = new Set(existing.map((r) => r.customerId));
      const fresh = [...resolved].filter((id) => !already.has(id));

      if (fresh.length > 0) {
        await tx.insert(schema.customerSegmentMembers).values(
          fresh.map((customerId) => ({ tenantId: ctx.tenantId, segmentId: seg.id, customerId, addedBy: actorId })),
        ).onConflictDoNothing();
      }

      const count = await countSegmentMembers(tx, ctx.tenantId, { id: seg.id, kind: "manual", rules: null }, new Map());
      await setSegmentCount(tx, ctx.tenantId, seg.id, count);

      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId,
        action: "segment.members_added",
        targetType: "segment",
        targetId: seg.id,
        diff: { added: fresh.length, customerIds: fresh.slice(0, 50) },
      });

      return { added: fresh.length, alreadyIn: already.size, notFound } satisfies AddMembersResult;
    }

    return { added: 0, alreadyIn: 0, notFound } satisfies AddMembersResult;
  });
}

export async function removeCustomersFromSegment(rt: Runtime, ctx: TenantContext, input: { segmentId: string; customerIds: string[] }) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;
  const ids = [...new Set(input.customerIds)];
  const actorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [seg] = await tx
      .select({ id: schema.customerSegments.id, kind: schema.customerSegments.kind, name: schema.customerSegments.name })
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.segmentId)))
      .limit(1);
    if (!seg) throw new Error(`Segment not found: ${input.segmentId}`);
    if (seg.kind !== "manual") throw new Error(`"${seg.name}" is automatic: its membership comes from the conditions and cannot be edited`);
    if (ids.length === 0) return { removed: 0 };

    const removedRows = await tx
      .delete(schema.customerSegmentMembers)
      .where(and(eq(schema.customerSegmentMembers.tenantId, ctx.tenantId), eq(schema.customerSegmentMembers.segmentId, seg.id), inArray(schema.customerSegmentMembers.customerId, ids)))
      .returning({ customerId: schema.customerSegmentMembers.customerId });

    const count = await countSegmentMembers(tx, ctx.tenantId, { id: seg.id, kind: "manual", rules: null }, new Map());
    await setSegmentCount(tx, ctx.tenantId, seg.id, count);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId,
      action: "segment.members_removed",
      targetType: "segment",
      targetId: seg.id,
      diff: { removed: removedRows.length, customerIds: removedRows.slice(0, 50).map((r) => r.customerId) },
    });

    return { removed: removedRows.length };
  });
}

export async function refreshSegmentCount(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "customers.read");
  return await touchCount(rt, ctx, input.id);
}

export interface CustomerSegmentsResult {
  manual: Array<{ id: string; name: string }>;
  automatic: Array<{ id: string; name: string }>;
}

export async function getCustomerSegments(rt: Runtime, ctx: TenantContext, input: { customerId: string }): Promise<CustomerSegmentsResult> {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const manualRows = await tx
      .select({ id: schema.customerSegments.id, name: schema.customerSegments.name })
      .from(schema.customerSegmentMembers)
      .innerJoin(schema.customerSegments, and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, schema.customerSegmentMembers.segmentId)))
      .where(and(eq(schema.customerSegmentMembers.tenantId, ctx.tenantId), eq(schema.customerSegmentMembers.customerId, input.customerId)))
      .orderBy(asc(schema.customerSegments.name));

    const automaticRows = await tx
      .select({ id: schema.customerSegments.id, name: schema.customerSegments.name, rules: schema.customerSegments.rules })
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.kind, "automatic")))
      .orderBy(asc(schema.customerSegments.name));

    const map = await loadSegmentMap(tx, ctx.tenantId);
    const matching: Array<{ id: string; name: string }> = [];
    // One query per automatic segment, capped by the 20-segment limit (PLAN §4).
    for (const seg of automaticRows) {
      const sub = segmentMemberSubquery(ctx.tenantId, parseSegmentRules(seg.rules), makeResolver(map));
      const res = await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM ${schema.customers} WHERE ${schema.customers.tenantId} = ${ctx.tenantId} AND ${schema.customers.deletedAt} IS NULL AND ${schema.customers.id} = ${input.customerId} AND ${schema.customers.id} IN ${sub}) AS yes`);
      if ((res.rows[0] as { yes: boolean } | undefined)?.yes) matching.push({ id: seg.id, name: seg.name });
    }

    return { manual: manualRows, automatic: matching };
  });
}

/** The editable templates offered by the empty state (PLAN §6). Values are defaults the owner edits after creating. */
export const SEGMENT_PRESETS: Array<{ name: string; description: string; rules: SegmentRules }> = [
  { name: "VIP customers", description: "Lifetime spend of ₹10,000 or more", rules: parseSegmentRules({ match: "all", conditions: [{ field: "total_spent", op: "gte", value: 1_000_000 }] }) },
  { name: "Repeat buyers", description: "Two or more counted orders", rules: parseSegmentRules({ match: "all", conditions: [{ field: "orders_count", op: "gte", value: 2 }] }) },
  { name: "New customers", description: "Joined in the last 30 days", rules: parseSegmentRules({ match: "all", conditions: [{ field: "created_at", op: "within_days", value: 30 }] }) },
  { name: "At risk", description: "No order in 90 days, but they ordered before", rules: parseSegmentRules({ match: "all", conditions: [{ field: "last_order_at", op: "older_than_days", value: 90 }, { field: "orders_count", op: "gte", value: 1 }] }) },
  { name: "Never purchased", description: "No counted order yet", rules: parseSegmentRules({ match: "all", conditions: [{ field: "orders_count", op: "eq", value: 0 }] }) },
  { name: "Marketing subscribers", description: "Consented to marketing email", rules: parseSegmentRules({ match: "all", conditions: [{ field: "marketing_state", op: "is", value: "subscribed" }] }) },
  { name: "Abandoned a checkout", description: "Left a checkout in the last 14 days", rules: parseSegmentRules({ match: "all", conditions: [{ field: "abandoned_checkout", op: "within_days", value: 14 }] }) },
];

export async function createPresetSegments(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "customers.write");
  const created: string[] = [];
  let skipped = 0;

  for (const preset of SEGMENT_PRESETS) {
    try {
      await createSegment(rt, ctx, { name: preset.name, description: preset.description, kind: "automatic", rules: preset.rules, isPreset: true });
      created.push(preset.name);
    } catch (e) {
      // A preset whose name exists, or one past the 20-segment limit, is skipped.
      skipped++;
      if (created.length === 0 && skipped > SEGMENT_PRESETS.length / 2 && !(e instanceof Error)) break;
    }
  }
  return { created: created.length, skipped };
}

/** Refreshes every segment's cached count for one tenant (or all tenants when tenantId is omitted). Used by the 6-hour job. */
export async function refreshAllSegmentCounts(db: Db, tenantId?: string): Promise<{ processed: number }> {
  const tenantIds = tenantId
    ? [tenantId]
    : (await db.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
  let processed = 0;
  for (const t of tenantIds) {
    await withTenant(db, t, async (tx) => {
      const map = await loadSegmentMap(tx, t);
      const rows = await tx
        .select({ id: schema.customerSegments.id, kind: schema.customerSegments.kind, rules: schema.customerSegments.rules, memberCount: schema.customerSegments.memberCount })
        .from(schema.customerSegments)
        .where(eq(schema.customerSegments.tenantId, t));
      for (const row of rows) {
        const count = await countSegmentMembers(tx, t, { id: row.id, kind: row.kind, rules: row.rules }, map);
        if (count !== row.memberCount) {
          await setSegmentCount(tx, t, row.id, count);
          processed++;
        }
      }
    });
  }
  return { processed };
}

/** Audit entries for one segment (the detail page's Activity tab). */
export async function getSegmentActivity(rt: Runtime, ctx: TenantContext, input: { segmentId: string; limit?: number | undefined }) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;
  const limit = input.limit ?? 50;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [seg] = await tx
      .select({ id: schema.customerSegments.id })
      .from(schema.customerSegments)
      .where(and(eq(schema.customerSegments.tenantId, ctx.tenantId), eq(schema.customerSegments.id, input.segmentId)))
      .limit(1);
    if (!seg) throw new Error(`Segment not found: ${input.segmentId}`);

    const rows = await tx
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        actorType: schema.auditLogs.actorType,
        actorId: schema.auditLogs.actorId,
        diff: schema.auditLogs.diff,
        createdAt: schema.auditLogs.createdAt,
      })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, ctx.tenantId), eq(schema.auditLogs.targetType, "segment"), eq(schema.auditLogs.targetId, input.segmentId)))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(limit);
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorType: r.actorType,
        actorId: r.actorId,
        diff: (r.diff as Record<string, unknown> | null) ?? {},
        at: r.createdAt.toISOString(),
      })),
    };
  });
}
