import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertQuota, QuotaExceededError } from "../system/quotas.ts";
import { writePlatformAudit, type AuditMeta } from "../platform-services.ts";

export interface ExportResult {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  fileKey?: string | null;
  downloadUrl?: string | null;
  expiresAt: string;
  totalRecords?: number;
}

/** A download link is valid for this long. It is only ever handed to an authenticated platform staff member. */
export const EXPORT_LINK_TTL_MS = 15 * 60 * 1000;

/** The export archive is kept for this long. */
const EXPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Tables that carry a tenant_id but are never part of a customer's data archive. */
const EXCLUDED_TABLES = new Set([
  "tenant_secrets",
  "idempotency_keys",
  "webhook_inbox",
  "exports",
  "export_files",
  "tenant_active_jobs",
  "tenant_owner_invites",
  "support_sessions",
  "tenant_deletions",
  "tenant_notes",
  "platform_audit_logs",
  "quota_events",
  "rate_limit_counters",
]);

/** Columns whose names suggest credentials, tokens or hashes are dropped from every table. */
const SENSITIVE_COLUMN = /(password|passwd|secret|token|hash|otp|api_?key|access_?key|refresh|signature)/i;

function signingSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Export downloads are unavailable: BETTER_AUTH_SECRET (32+ characters) is not configured");
  }
  return secret;
}

function sign(exportId: string, expiresAtMs: number): string {
  return createHmac("sha256", signingSecret()).update(`${exportId}:${expiresAtMs}`).digest("hex");
}

/** Creates a signed, short-lived download path for an export archive. */
export function signExportDownloadUrl(exportId: string, expiresAtMs: number): string {
  return `/api/platform/exports/${exportId}/download?expires=${expiresAtMs}&signature=${sign(exportId, expiresAtMs)}`;
}

/** Verifies a signed download token (timing-safe, rejects expired links). */
export function verifyExportSignature(exportId: string, expiresAtMs: number, signature: string): boolean {
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;
  const expected = Buffer.from(sign(exportId, expiresAtMs), "utf8");
  const given = Buffer.from(signature, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Runs a full store data export for a single tenant (PLAN §5.10, §6.4): every table that carries the store's
 * tenant_id, filtered by that id, with credential-like columns removed, gzipped into a real archive that is stored
 * (platform-only table) and downloadable through a signed, expiring link.
 * The archive contains only this store's rows. The export row, the archive and the audit row are written together.
 */
export async function runStoreExport(
  rt: Runtime,
  tenantId: string,
  requestedByUserId?: string,
  opts: { skipQuota?: boolean | undefined; audit?: boolean | undefined; link?: boolean | undefined; meta?: AuditMeta | undefined } = {},
): Promise<ExportResult> {
  const db = rt._db.db;

  if (!opts.skipQuota) {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [todayCountRes] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.exports)
        .where(and(eq(schema.exports.tenantId, tenantId), gte(schema.exports.createdAt, todayStart)));
      await assertQuota(db, tenantId, "exports_day", todayCountRes?.count ?? 0);
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
    }
  }

  const [tenant] = await db.select({ id: schema.tenants.id, slug: schema.tenants.slug }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error("Not Found: tenant not found");

  // Every tenant-owned table (found from the schema, so new tables are included automatically).
  const tablesRes = await db.execute<{ table_name: string }>(sql`
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
     ORDER BY c.table_name
  `);
  const tableNames = tablesRes.rows.map((r) => r.table_name).filter((t) => !EXCLUDED_TABLES.has(t));

  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const table of tableNames) {
    const colsRes = await db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}
    `);
    const sensitive = colsRes.rows.map((c) => c.column_name).filter((c) => SENSITIVE_COLUMN.test(c));
    // Credential-like columns are stripped from the JSON of every row.
    const stripped =
      sensitive.length > 0
        ? sql`(to_jsonb(t) - ARRAY[${sql.join(sensitive.map((c) => sql`${c}`), sql`, `)}]::text[])`
        : sql`to_jsonb(t)`;
    const rows = await db.execute<{ row: unknown }>(
      sql`SELECT ${stripped} AS row FROM ${sql.identifier(table)} t WHERE t.tenant_id = ${tenantId}`,
    );
    if (rows.rows.length > 0) {
      data[table] = rows.rows.map((r) => r.row);
      counts[table] = rows.rows.length;
    }
  }

  // The team, without credentials (memberships hold the role; users hold the identity).
  const team = await db.execute<{ email: string; name: string | null; role: string; status: string }>(sql`
    SELECT u.email::text AS email, u.name, r.name AS role, m.status
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
     WHERE m.tenant_id = ${tenantId}
  `);

  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
  const archive = {
    format: "bsec-store-export/1",
    exportedAt: new Date().toISOString(),
    tenant: { id: tenant.id, slug: tenant.slug },
    counts,
    team: team.rows,
    data,
  };
  const gz = gzipSync(Buffer.from(JSON.stringify(archive), "utf8"));
  const sha256 = createHash("sha256").update(gz).digest("hex");
  const expiresAt = new Date(Date.now() + EXPORT_RETENTION_MS);

  const exportId = await db.transaction(async (tx) => {
    const [record] = await tx
      .insert(schema.exports)
      .values({
        tenantId,
        type: "full_store",
        status: "completed",
        fileKey: `exports/${tenantId}`,
        fileSizeBytes: gz.length,
        requestedBy: requestedByUserId,
        expiresAt,
        metadata: { totalRecords, tables: Object.keys(counts).length, sha256 },
      })
      .returning({ id: schema.exports.id });
    if (!record) throw new Error("Failed to create export record");
    await tx.update(schema.exports).set({ fileKey: `exports/${tenantId}/${record.id}.json.gz` }).where(eq(schema.exports.id, record.id));
    await tx.insert(schema.exportFiles).values({ exportId: record.id, tenantId, sha256, data: gz });

    if (opts.audit !== false) {
      await writePlatformAudit(tx, requestedByUserId, "tenant.export_generated", "tenant", tenantId, tenantId, {
        exportId: record.id,
        totalRecords,
        sizeBytes: gz.length,
        sha256,
      }, opts.meta);
    }
    return record.id;
  });

  return {
    id: exportId,
    tenantId,
    type: "full_store",
    status: "completed",
    fileKey: `exports/${tenantId}/${exportId}.json.gz`,
    downloadUrl: opts.link === false ? null : signExportDownloadUrl(exportId, Date.now() + EXPORT_LINK_TTL_MS),
    expiresAt: expiresAt.toISOString(),
    totalRecords,
  };
}

/** Reads an export archive for download. Platform runtime only. */
export async function readExportArchive(rt: Runtime, exportId: string) {
  const [row] = await rt._db.db
    .select({
      tenantId: schema.exportFiles.tenantId,
      contentType: schema.exportFiles.contentType,
      sha256: schema.exportFiles.sha256,
      data: schema.exportFiles.data,
      expiresAt: schema.exports.expiresAt,
    })
    .from(schema.exportFiles)
    .innerJoin(schema.exports, eq(schema.exports.id, schema.exportFiles.exportId))
    .where(eq(schema.exportFiles.exportId, exportId))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}
