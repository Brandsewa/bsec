import { and, desc, eq } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import {
  assertPlatformStaff,
  assertRoleAtLeast,
  writePlatformAudit,
  type AuditMeta,
} from "../platform-services.ts";

export interface PlatformPlanChangeRequestItem {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  requestedBy: string;
  requestedByEmail: string;
  fromPlanId?: string | null;
  fromPlanCode?: string | null;
  toPlanId: string;
  toPlanCode: string;
  toPlanName: string;
  interval: "monthly" | "yearly";
  note?: string | null;
  status: "open" | "approved" | "declined" | "cancelled";
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  createdAt: string;
}

export interface DecidePlanChangeRequestInput {
  id: string;
  decision: "approved" | "declined";
  note?: string | undefined;
}

/**
 * Lists plan change requests across tenants for platform staff.
 * Reads through app_platform / BYPASSRLS.
 */
export async function listPlatformPlanChangeRequests(
  rt: Runtime,
  staffUserId: string,
  statusFilter?: "open" | "approved" | "declined" | "cancelled",
): Promise<PlatformPlanChangeRequestItem[]> {
  await assertPlatformStaff(rt, staffUserId);
  const db = rt._db.db;

  const conditions = [];
  if (statusFilter) {
    conditions.push(eq(schema.planChangeRequests.status, statusFilter));
  }

  const rows = await db
    .select({
      id: schema.planChangeRequests.id,
      tenantId: schema.planChangeRequests.tenantId,
      requestedBy: schema.planChangeRequests.requestedBy,
      fromPlanId: schema.planChangeRequests.fromPlanId,
      toPlanId: schema.planChangeRequests.toPlanId,
      interval: schema.planChangeRequests.interval,
      note: schema.planChangeRequests.note,
      status: schema.planChangeRequests.status,
      decidedBy: schema.planChangeRequests.decidedBy,
      decidedAt: schema.planChangeRequests.decidedAt,
      decisionNote: schema.planChangeRequests.decisionNote,
      createdAt: schema.planChangeRequests.createdAt,
      tenantSlug: schema.tenants.slug,
      tenantName: schema.tenants.name,
      userEmail: schema.users.email,
    })
    .from(schema.planChangeRequests)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.planChangeRequests.tenantId))
    .innerJoin(schema.users, eq(schema.users.id, schema.planChangeRequests.requestedBy))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.planChangeRequests.createdAt))
    .limit(100);

  // Fetch plan names/codes
  const planRows = await db.select({ id: schema.plans.id, code: schema.plans.code, name: schema.plans.name }).from(schema.plans);
  const planMap = new Map(planRows.map((p) => [p.id, p]));

  return rows.map((r) => {
    const toPlan = planMap.get(r.toPlanId);
    const fromPlan = r.fromPlanId ? planMap.get(r.fromPlanId) : null;
    return {
      id: r.id,
      tenantId: r.tenantId as string,
      tenantSlug: r.tenantSlug,
      tenantName: r.tenantName,
      requestedBy: r.requestedBy,
      requestedByEmail: r.userEmail,
      fromPlanId: r.fromPlanId,
      fromPlanCode: fromPlan?.code ?? null,
      toPlanId: r.toPlanId,
      toPlanCode: toPlan?.code ?? "unknown",
      toPlanName: toPlan?.name ?? "Unknown Plan",
      interval: r.interval as "monthly" | "yearly",
      note: r.note,
      status: r.status as "open" | "approved" | "declined" | "cancelled",
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/**
 * Decides a plan-change request (approve or decline).
 * Platform mutation: requires platform_admin and writes platform_audit_logs.
 * Note: Approve marks the request approved and advises staff to perform change via Super Admin plan tools.
 */
export async function decidePlatformPlanChangeRequest(
  rt: Runtime,
  staffUserId: string,
  input: DecidePlanChangeRequestInput,
  meta?: AuditMeta,
): Promise<{ id: string; status: "approved" | "declined"; message: string }> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "decide plan change request");
  const db = rt._db.db;

  const [req] = await db
    .select()
    .from(schema.planChangeRequests)
    .where(eq(schema.planChangeRequests.id, input.id))
    .limit(1);

  if (!req) {
    throw new Error("Plan change request not found");
  }

  if (req.status !== "open") {
    throw new Error(`Cannot decide request with status '${req.status}'`);
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(schema.planChangeRequests)
      .set({
        status: input.decision,
        decidedBy: staffUserId,
        decidedAt: now,
        decisionNote: input.note ? input.note.trim() : null,
        updatedAt: now,
      })
      .where(eq(schema.planChangeRequests.id, input.id));

    // Platform audit log
    await writePlatformAudit(
      tx,
      staffUserId,
      `plan_change_request.${input.decision}`,
      "plan_change_requests",
      input.id,
      req.tenantId,
      {
        decision: { before: "open", after: input.decision },
        note: { before: null, after: input.note ?? null },
      },
      meta,
    );
  });

  const msg =
    input.decision === "approved"
      ? "Plan change request approved. Please perform the plan change in Tenant details if required."
      : "Plan change request declined.";

  return {
    id: input.id,
    status: input.decision,
    message: msg,
  };
}
