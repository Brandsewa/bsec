/**
 * One row per AI call for the activity view and the usage meter. Never stores prompts, arguments or results (docs/MCP-PLAN.md
 * section 6): tool name, outcome, time and size only.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { AgentSession } from "./session.ts";

export type AgentCallStatus = "ok" | "denied" | "rate_limited" | "error";

export async function recordAgentCall(
  db: Db,
  session: AgentSession,
  call: { tool: string; status: AgentCallStatus; durationMs: number; bytes: number },
): Promise<void> {
  try {
    await withTenant(db, session.ctx.tenantId, async (tx) => {
      await tx.insert(schema.agentCallLog).values({
        tenantId: session.ctx.tenantId,
        connectionId: session.connection.id,
        tool: call.tool.slice(0, 60),
        status: call.status,
        durationMs: Math.max(0, Math.round(call.durationMs)),
        bytes: Math.max(0, Math.round(call.bytes)),
      });
    });
  } catch {
    // the log must never break a request
  }
}

export interface AgentCallEntry {
  id: string;
  connectionId: string;
  tool: string;
  status: string;
  durationMs: number;
  createdAt: string;
}

export async function listAgentCalls(db: Db, tenantId: string, limit = 50): Promise<AgentCallEntry[]> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(schema.agentCallLog)
      .where(eq(schema.agentCallLog.tenantId, tenantId))
      .orderBy(desc(schema.agentCallLog.createdAt))
      .limit(Math.min(limit, 200)),
  );
  return rows.map((r) => ({ id: r.id, connectionId: r.connectionId, tool: r.tool, status: r.status, durationMs: r.durationMs, createdAt: r.createdAt.toISOString() }));
}

/** Retention: 90 days. Called from the worker's maintenance job. */
export async function pruneAgentCallLog(db: Db, tenantId: string): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.delete(schema.agentCallLog).where(and(eq(schema.agentCallLog.tenantId, tenantId), lt(schema.agentCallLog.createdAt, sql`now() - interval '90 days'`)));
  });
}
