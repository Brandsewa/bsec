import { eq, and, desc } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import {
  validatePolicyContent,
  type PolicyContent,
} from "./validator.ts";
import {
  POLICY_STARTERS,
  hasStarterPlaceholders,
  type PolicyHandle,
} from "./starters.ts";

export interface PolicySummaryItem {
  id: string;
  handle: PolicyHandle;
  title: string;
  hasDraft: boolean;
  publishedVersion: number | null;
  publishedAt: string | null;
  draftUpdatedAt: string;
}

export interface PolicyDetailView {
  id: string;
  handle: PolicyHandle;
  title: string;
  draftContent: PolicyContent;
  publishedVersion: {
    id: string;
    version: number;
    title: string;
    content: PolicyContent;
    contentSha256: string;
    publishedAt: string;
  } | null;
  draftUpdatedAt: string;
}

export interface PolicyVersionItem {
  id: string;
  version: number;
  title: string;
  content: PolicyContent;
  contentSha256: string;
  publishedBy: string | null;
  publishedAt: string;
}

const VALID_HANDLES: PolicyHandle[] = ["refund", "privacy", "terms", "shipping", "legal_notice"];

/**
 * Ensures policy rows exist for all 5 handles for this tenant.
 */
async function ensurePoliciesSeeded(tx: Db, tenantId: string): Promise<void> {
  const existing = await tx
    .select({ handle: schema.storePolicies.handle })
    .from(schema.storePolicies)
    .where(eq(schema.storePolicies.tenantId, tenantId));

  const existingSet = new Set(existing.map((e) => e.handle));

  for (const handle of VALID_HANDLES) {
    if (!existingSet.has(handle)) {
      const starter = POLICY_STARTERS[handle];
      await tx.insert(schema.storePolicies).values({
        tenantId,
        handle,
        title: starter.title,
        draftContent: starter.content as unknown as Record<string, unknown>,
        publishedVersionId: null,
      });
    }
  }
}

/**
 * List all policies for a store. Requires policies.manage or settings.read.
 */
export async function listPolicies(
  rt: Runtime,
  ctx: TenantContext,
): Promise<PolicySummaryItem[]> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    await ensurePoliciesSeeded(tx, ctx.tenantId);

    const rows = await tx
      .select({
        id: schema.storePolicies.id,
        handle: schema.storePolicies.handle,
        title: schema.storePolicies.title,
        publishedVersionId: schema.storePolicies.publishedVersionId,
        draftUpdatedAt: schema.storePolicies.draftUpdatedAt,
      })
      .from(schema.storePolicies)
      .where(eq(schema.storePolicies.tenantId, ctx.tenantId));

    const result: PolicySummaryItem[] = [];

    for (const r of rows) {
      let publishedVersion: number | null = null;
      let publishedAt: string | null = null;

      if (r.publishedVersionId) {
        const [vRow] = await tx
          .select({
            version: schema.storePolicyVersions.version,
            publishedAt: schema.storePolicyVersions.publishedAt,
          })
          .from(schema.storePolicyVersions)
          .where(
            and(
              eq(schema.storePolicyVersions.tenantId, ctx.tenantId),
              eq(schema.storePolicyVersions.id, r.publishedVersionId),
            ),
          )
          .limit(1);
        if (vRow) {
          publishedVersion = vRow.version;
          publishedAt = vRow.publishedAt.toISOString();
        }
      }

      result.push({
        id: r.id,
        handle: r.handle as PolicyHandle,
        title: r.title,
        hasDraft: true,
        publishedVersion,
        publishedAt,
        draftUpdatedAt: r.draftUpdatedAt.toISOString(),
      });
    }

    return result;
  });
}

/**
 * Get detailed policy by handle or id.
 */
export async function getPolicy(
  rt: Runtime,
  ctx: TenantContext,
  handleOrId: string,
): Promise<PolicyDetailView> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    await ensurePoliciesSeeded(tx, ctx.tenantId);

    const [row] = await tx
      .select()
      .from(schema.storePolicies)
      .where(
        and(
          eq(schema.storePolicies.tenantId, ctx.tenantId),
          VALID_HANDLES.includes(handleOrId as PolicyHandle)
            ? eq(schema.storePolicies.handle, handleOrId)
            : eq(schema.storePolicies.id, handleOrId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new Error(`Policy not found: ${handleOrId}`);
    }

    let publishedVersion: PolicyDetailView["publishedVersion"] = null;
    if (row.publishedVersionId) {
      const [vRow] = await tx
        .select()
        .from(schema.storePolicyVersions)
        .where(
          and(
            eq(schema.storePolicyVersions.tenantId, ctx.tenantId),
            eq(schema.storePolicyVersions.id, row.publishedVersionId),
          ),
        )
        .limit(1);
      if (vRow) {
        publishedVersion = {
          id: vRow.id,
          version: vRow.version,
          title: vRow.title,
          content: vRow.content as PolicyContent,
          contentSha256: vRow.contentSha256,
          publishedAt: vRow.publishedAt.toISOString(),
        };
      }
    }

    return {
      id: row.id,
      handle: row.handle as PolicyHandle,
      title: row.title,
      draftContent: row.draftContent as PolicyContent,
      publishedVersion,
      draftUpdatedAt: row.draftUpdatedAt.toISOString(),
    };
  });
}

/**
 * Save draft for a policy. Enforces policies.manage and audits change.
 */
export async function savePolicyDraft(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    handle: PolicyHandle;
    title?: string | undefined;
    content: unknown;
  },
): Promise<PolicyDetailView> {
  assertPermission(ctx, "policies.manage");
  const db = rt._db.db;

  const validated = validatePolicyContent(input.content);
  if (!validated.valid) {
    throw new Error(`Policy content validation failed: ${validated.error}`);
  }

  return await withTenant(db, ctx.tenantId, async (tx) => {
    await ensurePoliciesSeeded(tx, ctx.tenantId);

    const [existing] = await tx
      .select()
      .from(schema.storePolicies)
      .where(
        and(
          eq(schema.storePolicies.tenantId, ctx.tenantId),
          eq(schema.storePolicies.handle, input.handle),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error(`Policy handle not found: ${input.handle}`);
    }

    const title = input.title?.trim() || existing.title;
    const now = new Date();

    await tx
      .update(schema.storePolicies)
      .set({
        title,
        draftContent: validated.data as unknown as Record<string, unknown>,
        draftUpdatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.storePolicies.tenantId, ctx.tenantId),
          eq(schema.storePolicies.id, existing.id),
        ),
      );

    // Audit log
    if (ctx.actor?.type === "staff") {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.userId,
        action: "policy.draft_saved",
        targetType: "store_policy",
        targetId: existing.id,
        diff: {
          handle: input.handle,
          title,
        },
      });
    }

    let publishedVersion: PolicyDetailView["publishedVersion"] = null;
    if (existing.publishedVersionId) {
      const [vRow] = await tx
        .select()
        .from(schema.storePolicyVersions)
        .where(
          and(
            eq(schema.storePolicyVersions.tenantId, ctx.tenantId),
            eq(schema.storePolicyVersions.id, existing.publishedVersionId),
          ),
        )
        .limit(1);
      if (vRow) {
        publishedVersion = {
          id: vRow.id,
          version: vRow.version,
          title: vRow.title,
          content: vRow.content as PolicyContent,
          contentSha256: vRow.contentSha256,
          publishedAt: vRow.publishedAt.toISOString(),
        };
      }
    }

    return {
      id: existing.id,
      handle: existing.handle as PolicyHandle,
      title,
      draftContent: validated.data as PolicyContent,
      publishedVersion,
      draftUpdatedAt: now.toISOString(),
    };
  });
}

/**
 * Publish a policy.
 * Validates no starter placeholders or advice banner, snapshots to immutable store_policy_versions,
 * updates publishedVersionId, and audits.
 */
export async function publishPolicy(
  rt: Runtime,
  ctx: TenantContext,
  handle: PolicyHandle,
): Promise<PolicyDetailView> {
  assertPermission(ctx, "policies.manage");
  const db = rt._db.db;

  const result = await withTenant(db, ctx.tenantId, async (tx) => {
    await ensurePoliciesSeeded(tx, ctx.tenantId);

    const [policy] = await tx
      .select()
      .from(schema.storePolicies)
      .where(
        and(
          eq(schema.storePolicies.tenantId, ctx.tenantId),
          eq(schema.storePolicies.handle, handle),
        ),
      )
      .limit(1);

    if (!policy) {
      throw new Error(`Policy handle not found: ${handle}`);
    }

    const content = policy.draftContent as PolicyContent;
    const validated = validatePolicyContent(content);
    if (!validated.valid) {
      throw new Error(`Cannot publish: invalid content - ${validated.error}`);
    }

    const placeholderCheck = hasStarterPlaceholders(validated.data);
    if (placeholderCheck.hasPlaceholders) {
      throw new Error(`Cannot publish policy: ${placeholderCheck.reason}`);
    }

    // Determine next version number
    const [latestVersionRow] = await tx
      .select({ version: schema.storePolicyVersions.version })
      .from(schema.storePolicyVersions)
      .where(
        and(
          eq(schema.storePolicyVersions.tenantId, ctx.tenantId),
          eq(schema.storePolicyVersions.policyId, policy.id),
        ),
      )
      .orderBy(desc(schema.storePolicyVersions.version))
      .limit(1);

    const nextVersion = (latestVersionRow?.version ?? 0) + 1;
    const now = new Date();

    // Insert immutable version snapshot
    const [createdVersion] = await tx
      .insert(schema.storePolicyVersions)
      .values({
        tenantId: ctx.tenantId,
        policyId: policy.id,
        version: nextVersion,
        title: policy.title,
        content: validated.data as unknown as Record<string, unknown>,
        contentSha256: validated.sha256,
        publishedBy: ctx.actor?.type === "staff" ? ctx.actor.userId : null,
        publishedAt: now,
      })
      .returning({ id: schema.storePolicyVersions.id });

    if (!createdVersion) {
      throw new Error("Failed to insert policy version");
    }

    // Update published pointer on policy root
    await tx
      .update(schema.storePolicies)
      .set({
        publishedVersionId: createdVersion.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.storePolicies.tenantId, ctx.tenantId),
          eq(schema.storePolicies.id, policy.id),
        ),
      );

    // Audit log
    if (ctx.actor?.type === "staff") {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.userId,
        action: "policy.published",
        targetType: "store_policy",
        targetId: policy.id,
        diff: {
          handle,
          version: nextVersion,
          versionId: createdVersion.id,
          sha256: validated.sha256,
        },
      });
    }

    return {
      id: policy.id,
      handle: policy.handle as PolicyHandle,
      title: policy.title,
      draftContent: validated.data as PolicyContent,
      publishedVersion: {
        id: createdVersion.id,
        version: nextVersion,
        title: policy.title,
        content: validated.data as PolicyContent,
        contentSha256: validated.sha256,
        publishedAt: now.toISOString(),
      },
      draftUpdatedAt: policy.draftUpdatedAt.toISOString(),
    };
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return result;
}

/**
 * Get version history for a policy.
 */
export async function getPolicyVersions(
  rt: Runtime,
  ctx: TenantContext,
  handle: PolicyHandle,
): Promise<PolicyVersionItem[]> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [policy] = await tx
      .select({ id: schema.storePolicies.id })
      .from(schema.storePolicies)
      .where(
        and(
          eq(schema.storePolicies.tenantId, ctx.tenantId),
          eq(schema.storePolicies.handle, handle),
        ),
      )
      .limit(1);

    if (!policy) return [];

    const versions = await tx
      .select()
      .from(schema.storePolicyVersions)
      .where(
        and(
          eq(schema.storePolicyVersions.tenantId, ctx.tenantId),
          eq(schema.storePolicyVersions.policyId, policy.id),
        ),
      )
      .orderBy(desc(schema.storePolicyVersions.version));

    return versions.map((v) => ({
      id: v.id,
      version: v.version,
      title: v.title,
      content: v.content as PolicyContent,
      contentSha256: v.contentSha256,
      publishedBy: v.publishedBy,
      publishedAt: v.publishedAt.toISOString(),
    }));
  });
}

/**
 * Restore an old version as the current draft without rewriting history.
 */
export async function restorePolicyDraft(
  rt: Runtime,
  ctx: TenantContext,
  input: { handle: PolicyHandle; versionId: string },
): Promise<PolicyDetailView> {
  assertPermission(ctx, "policies.manage");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [policy] = await tx
      .select({ id: schema.storePolicies.id })
      .from(schema.storePolicies)
      .where(
        and(
          eq(schema.storePolicies.tenantId, ctx.tenantId),
          eq(schema.storePolicies.handle, input.handle),
        ),
      )
      .limit(1);

    if (!policy) {
      throw new Error(`Policy not found: ${input.handle}`);
    }

    const [vRow] = await tx
      .select()
      .from(schema.storePolicyVersions)
      .where(
        and(
          eq(schema.storePolicyVersions.tenantId, ctx.tenantId),
          eq(schema.storePolicyVersions.id, input.versionId),
        ),
      )
      .limit(1);

    if (!vRow) {
      throw new Error(`Policy version not found: ${input.versionId}`);
    }

    const now = new Date();
    await tx
      .update(schema.storePolicies)
      .set({
        title: vRow.title,
        draftContent: vRow.content,
        draftUpdatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.storePolicies.tenantId, ctx.tenantId),
          eq(schema.storePolicies.id, policy.id),
        ),
      );

    if (ctx.actor?.type === "staff") {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.userId,
        action: "policy.restored_as_draft",
        targetType: "store_policy",
        targetId: policy.id,
        diff: {
          handle: input.handle,
          restoredVersion: vRow.version,
          versionId: vRow.id,
        },
      });
    }

    return {
      id: policy.id,
      handle: input.handle,
      title: vRow.title,
      draftContent: vRow.content as PolicyContent,
      publishedVersion: null,
      draftUpdatedAt: now.toISOString(),
    };
  });
}

/**
 * Reads published policy for storefront shoppers.
 * Drafts are never served to shoppers!
 */
export async function getPublishedPolicy(
  db: Db,
  tenantId: string,
  handle: PolicyHandle,
): Promise<{ title: string; content: PolicyContent; version: number; publishedAt: string } | null> {
  return await withTenant(db, tenantId, async (tx) => {
    const [policy] = await tx
      .select({ publishedVersionId: schema.storePolicies.publishedVersionId })
      .from(schema.storePolicies)
      .where(
        and(
          eq(schema.storePolicies.tenantId, tenantId),
          eq(schema.storePolicies.handle, handle),
        ),
      )
      .limit(1);

    if (!policy?.publishedVersionId) {
      return null;
    }

    const [vRow] = await tx
      .select()
      .from(schema.storePolicyVersions)
      .where(
        and(
          eq(schema.storePolicyVersions.tenantId, tenantId),
          eq(schema.storePolicyVersions.id, policy.publishedVersionId),
        ),
      )
      .limit(1);

    if (!vRow) return null;

    return {
      title: vRow.title,
      content: vRow.content as PolicyContent,
      version: vRow.version,
      publishedAt: vRow.publishedAt.toISOString(),
    };
  });
}
