import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { writePlatformAudit } from "../platform-services.ts";
import { PURGE_KEEP_TABLES, purgeTenantData } from "../admin/tenant-purge.ts";
import { CloudflareCustomDomainProvider, type CustomDomainProvider } from "../domains/provider.ts";
import { RazorpaySubscriptionProvider, type SubscriptionBillingProvider } from "../saas/billing.ts";
import { createR2Client, getR2Config } from "../media/storage.ts";
import { runStoreExport } from "./exports.ts";
import type { DeletionRow, DeletionStep } from "./deletion-requests.ts";

export interface DeletionDeps {
  billing?: SubscriptionBillingProvider | undefined;
  domains?: CustomDomainProvider | undefined;
  /** Deletes storage objects; return the number deleted. Defaults to Cloudflare R2 when its keys are configured. */
  deleteMediaObjects?: ((keys: string[]) => Promise<number>) | undefined;
  /** Replaces the export step (tests). */
  runExport?: typeof runStoreExport | undefined;
  now?: Date | undefined;
}

async function deleteFromR2(keys: string[]): Promise<number> {
  const cfg = getR2Config();
  const client = createR2Client();
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const res = await client.send(new DeleteObjectsCommand({ Bucket: cfg.bucketName ?? "", Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
    if (res.Errors && res.Errors.length > 0) throw new Error(`R2 rejected ${res.Errors.length} deletions`);
    deleted += batch.length;
  }
  return deleted;
}

/** Moves the deletion to the next step and writes the audit row for it, in the caller's transaction. */
async function advance(
  tx: Db,
  d: DeletionRow,
  next: DeletionStep,
  extra: Record<string, unknown> = {},
  set: Partial<typeof schema.tenantDeletions.$inferInsert> = {},
) {
  await tx
    .update(schema.tenantDeletions)
    .set({ step: next, error: null, updatedAt: sql`now()`, ...set })
    .where(eq(schema.tenantDeletions.id, d.id));
  await writePlatformAudit(tx, d.requestedBy ?? undefined, `tenant.deletion_step.${next}`, "tenant", d.tenantId, d.tenantId, { deletionId: d.id, ...extra });
}

/** Step 1: a real export archive is taken first. If it fails, nothing further happens. */
export async function stepExport(rt: Runtime, d: DeletionRow, deps: DeletionDeps = {}): Promise<void> {
  const exp = await (deps.runExport ?? runStoreExport)(rt, d.tenantId, d.requestedBy ?? undefined, { skipQuota: true, audit: false, link: false });
  await rt._db.db.transaction((tx) => advance(tx, d, "exported", { exportId: exp.id, totalRecords: exp.totalRecords }, { exportId: exp.id }));
}

/** Step 2: subscriptions are cancelled (with the provider too, when it is configured). */
export async function stepStopBilling(rt: Runtime, d: DeletionRow, deps: DeletionDeps): Promise<void> {
  const db = rt._db.db;
  const subs = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, d.tenantId));
  const provider = deps.billing ?? new RazorpaySubscriptionProvider();
  let providerCancelled = 0;
  if (provider.isConfigured?.() ?? true) {
    for (const s of subs) {
      if (s.providerSubscriptionId && s.status !== "cancelled") {
        await provider.cancelSubscription(s.providerSubscriptionId);
        providerCancelled++;
      }
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(schema.subscriptions)
      .set({ status: "cancelled", cancelAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.subscriptions.tenantId, d.tenantId));
    await advance(tx, d, "billing_stopped", { subscriptions: subs.length, providerCancelled });
  });
}

/** Step 3: custom domains are released (at Cloudflare too, when configured) and every domain row is marked removed. */
export async function stepDisconnectDomains(rt: Runtime, d: DeletionRow, deps: DeletionDeps): Promise<void> {
  const db = rt._db.db;
  const domains = await db.select().from(schema.domains).where(eq(schema.domains.tenantId, d.tenantId));
  const provider = deps.domains ?? new CloudflareCustomDomainProvider();
  let providerRemoved = 0;
  if (provider.isConfigured?.() ?? true) {
    for (const dom of domains) {
      if (dom.type === "custom" && dom.cfCustomHostnameId) {
        await provider.deleteCustomHostname(dom.cfCustomHostnameId);
        providerRemoved++;
      }
    }
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.domains).set({ status: "removed", updatedAt: sql`now()` }).where(eq(schema.domains.tenantId, d.tenantId));
    await advance(tx, d, "domains_disconnected", { domains: domains.length, providerRemoved });
  });
}

/** Step 4: media objects are removed from object storage. When storage is not configured that is recorded, not faked. */
export async function stepScheduleMedia(rt: Runtime, d: DeletionRow, deps: DeletionDeps): Promise<void> {
  const db = rt._db.db;
  const media = await db.select({ key: schema.media.storageKey }).from(schema.media).where(eq(schema.media.tenantId, d.tenantId));
  const keys = media.map((m) => m.key);
  const cfg = getR2Config();
  const configured = Boolean(deps.deleteMediaObjects) || Boolean(cfg.accessKeyId && cfg.secretAccessKey);
  let deleted = 0;
  if (configured && keys.length > 0) deleted = await (deps.deleteMediaObjects ?? deleteFromR2)(keys);
  await db.transaction(async (tx) => {
    await advance(
      tx,
      d,
      "media_scheduled",
      { mediaObjects: keys.length, deleted, storageConfigured: configured, ...(configured ? {} : { pendingManualCleanup: keys.length }) },
      { metadata: { ...((d.metadata as Record<string, unknown> | null) ?? {}), media: { objects: keys.length, deleted, storageConfigured: configured } } },
    );
  });
}

/** Step 5: every row of the store is removed; the workflow's own records, invoices and audit trail stay. */
export async function stepPurgeData(rt: Runtime, d: DeletionRow): Promise<void> {
  const purged = await purgeTenantData(rt._db.db, d.tenantId);
  await rt._db.db.transaction((tx) => advance(tx, d, "db_purged", { deletedRows: purged.deleted }));
}

/** Step 6: proves that no tenant row survived the purge. */
export async function stepVerifyPurge(rt: Runtime, d: DeletionRow): Promise<void> {
  const db = rt._db.db;
  const tablesRes = await db.execute<{ table_name: string }>(sql`
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
  `);
  for (const r of tablesRes.rows) {
    if (PURGE_KEEP_TABLES.has(r.table_name)) continue;
    const check = await db.execute<{ count: string }>(sql`SELECT count(*) FROM ${sql.identifier(r.table_name)} WHERE tenant_id = ${d.tenantId}`);
    const remaining = Number(check.rows[0]?.count ?? 0);
    if (remaining > 0) throw new Error(`Verification failed: ${remaining} rows remain in ${r.table_name} for tenant ${d.tenantId}`);
  }
  await db.transaction((tx) => advance(tx, d, "verified", {}));
}

/** Step 7 (terminal): the store is marked deleted and the deletion completed, with the final audit row. */
export async function stepFinish(rt: Runtime, d: DeletionRow): Promise<void> {
  await rt._db.db.transaction(async (tx) => {
    await tx.update(schema.tenants).set({ status: "deleted", updatedAt: sql`now()` }).where(eq(schema.tenants.id, d.tenantId));
    await tx
      .update(schema.tenantDeletions)
      .set({ step: "deleted", completedAt: sql`now()`, error: null, updatedAt: sql`now()` })
      .where(eq(schema.tenantDeletions.id, d.id));
    await writePlatformAudit(tx, d.requestedBy ?? undefined, "tenant.deleted", "tenant", d.tenantId, d.tenantId, {
      deletionId: d.id,
      exportId: d.exportId,
    });
  });
}
