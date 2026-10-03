import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

/** Staff notes about a customer (Customers Phase 1, step 1B). Replaces the single `customers.note`. */

export interface CustomerNoteRecord {
  id: string;
  customerId: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

export async function listCustomerNotes(rt: Runtime, ctx: TenantContext, input: { customerId: string }): Promise<{ items: CustomerNoteRecord[] }> {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.customerNotes.id,
        customerId: schema.customerNotes.customerId,
        body: schema.customerNotes.body,
        authorId: schema.customerNotes.authorId,
        authorName: schema.users.name,
        createdAt: schema.customerNotes.createdAt,
      })
      .from(schema.customerNotes)
      .leftJoin(schema.users, eq(schema.users.id, schema.customerNotes.authorId))
      .where(and(eq(schema.customerNotes.tenantId, ctx.tenantId), eq(schema.customerNotes.customerId, input.customerId)))
      .orderBy(desc(schema.customerNotes.createdAt), desc(schema.customerNotes.id));

    return {
      items: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        body: r.body,
        authorId: r.authorId,
        authorName: r.authorName,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}

export async function addCustomerNote(rt: Runtime, ctx: TenantContext, input: { customerId: string; body: string }): Promise<{ id: string; createdAt: string }> {
  assertPermission(ctx, "customers.write");
  const body = input.body.trim();
  if (!body) throw new Error("A note cannot be empty");
  if (body.length > 1000) throw new Error("A note can be at most 1000 characters");
  const db = rt._db.db;
  const authorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [customer] = await tx
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.customerId)))
      .limit(1);
    if (!customer) throw new Error(`Customer not found: ${input.customerId}`);

    const [row] = await tx
      .insert(schema.customerNotes)
      .values({ tenantId: ctx.tenantId, customerId: input.customerId, authorId, body })
      .returning({ id: schema.customerNotes.id, createdAt: schema.customerNotes.createdAt });

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: authorId,
      action: "customer.note_added",
      targetType: "customer",
      targetId: input.customerId,
      diff: { noteId: row!.id },
    });

    return { id: row!.id, createdAt: row!.createdAt.toISOString() };
  });
}

export async function deleteCustomerNote(rt: Runtime, ctx: TenantContext, input: { id: string }): Promise<{ success: boolean }> {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;
  const authorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;
  const isOwner = ctx.roles.includes("store_owner");

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: schema.customerNotes.id, customerId: schema.customerNotes.customerId, authorId: schema.customerNotes.authorId })
      .from(schema.customerNotes)
      .where(and(eq(schema.customerNotes.tenantId, ctx.tenantId), eq(schema.customerNotes.id, input.id)))
      .limit(1);
    if (!row) throw new Error(`Note not found: ${input.id}`);

    // The author may retract their own note; only the store owner may delete anyone's.
    if (!isOwner && row.authorId !== authorId) {
      throw new Error("Only the note's author or the store owner can delete a note");
    }

    await tx.delete(schema.customerNotes).where(and(eq(schema.customerNotes.tenantId, ctx.tenantId), eq(schema.customerNotes.id, input.id)));

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: authorId,
      action: "customer.note_deleted",
      targetType: "customer",
      targetId: row.customerId,
      diff: { noteId: row.id },
    });

    return { success: true };
  });
}
