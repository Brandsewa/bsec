/**
 * Audit trail for changes an AI app makes (ADR-050 decision 7, hard rule 6). The row carries what changed (`before` and `after`),
 * which connection did it and the app's name, so the merchant can see "done by Claude" and a later undo has the old values.
 * `actor_id` is the staff user who approved the connection.
 */
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { AgentSession } from "./session.ts";

export async function writeAgentAudit(
  rt: Runtime,
  session: AgentSession,
  entry: { action: string; targetType: string; targetId: string; before?: unknown; after?: unknown },
): Promise<void> {
  await withTenant(rt._db.db, session.ctx.tenantId, async (tx) => {
    await tx.insert(schema.auditLogs).values({
      tenantId: session.ctx.tenantId,
      actorType: "agent",
      actorId: session.connection.userId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      diff: { via: "agent", connectionId: session.connection.id, client: session.connection.clientName, before: entry.before ?? null, after: entry.after ?? null },
      requestId: session.ctx.requestId,
    });
  });
}
