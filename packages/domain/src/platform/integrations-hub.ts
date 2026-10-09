import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff } from "../platform-services.ts";

export interface ChannelStatsOptions {
  channel: "email" | "sms" | "whatsapp";
  range: "24h" | "7d" | "30d";
}

export interface ChannelTransactionsOptions {
  channel: "email" | "sms" | "whatsapp";
  status?: "sent" | "failed" | "skipped" | undefined;
  template?: string | undefined;
  tenantId?: string | undefined;
  failedOnly?: boolean | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Gets high-level platform integrations overview metrics for hub cards.
 */
export async function getPlatformIntegrationsOverview(
  rt: Runtime,
  platformStaffUserId: string,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  // 1. Email 7d stats and settings
  const emailSettingsRow = await db
    .select()
    .from(schema.platformEmailSettings)
    .where(eq(schema.platformEmailSettings.id, "default"))
    .limit(1);

  const emailCfg = emailSettingsRow[0];
  let emailStatus: "active" | "not_configured" | "failing" = "not_configured";
  if (emailCfg?.enabled) {
    emailStatus = emailCfg.lastTestStatus === "failed" ? "failing" : "active";
  }

  const [email7d] = await db
    .select({
      sent: sql<string>`count(*) filter (where ${schema.platformEmailLog.status} = 'sent')`,
      failed: sql<string>`count(*) filter (where ${schema.platformEmailLog.status} = 'failed')`,
    })
    .from(schema.platformEmailLog)
    .where(sql`${schema.platformEmailLog.createdAt} >= now() - interval '7 days'`);

  // 2. Storage summary
  const [activeStorageRes] = await db
    .select({
      activeCount: sql<string>`count(*)`,
    })
    .from(schema.platformStorageConnections)
    .where(eq(schema.platformStorageConnections.isActive, true));

  const [mediaStats] = await db
    .select({
      totalBytes: sql<string>`coalesce(sum(${schema.media.bytes}), 0)`,
      totalFiles: sql<string>`count(*)`,
    })
    .from(schema.media);

  // 3. Payments summary (will expand in Slice D)
  return {
    channels: {
      email: {
        status: emailStatus,
        sent7d: Number(email7d?.sent ?? 0),
        failed7d: Number(email7d?.failed ?? 0),
        provider: emailCfg?.provider ?? "zoho_zeptomail",
      },
      sms: {
        status: "not_enrolled" as const,
        sent7d: 0,
        failed7d: 0,
        provider: "zoho_cpaas",
      },
      whatsapp: {
        status: "not_enrolled" as const,
        sent7d: 0,
        failed7d: 0,
        provider: "zoho_cpaas",
      },
    },
    storage: {
      activeConnections: Number(activeStorageRes?.activeCount ?? 0),
      totalBytes: Number(mediaStats?.totalBytes ?? 0),
      totalFiles: Number(mediaStats?.totalFiles ?? 0),
    },
    payments: {
      enabledProviders: ["razorpay"],
      totalConnectedStores: 0,
    },
  };
}

/**
 * Gets stats for a channel over the given range (24h, 7d, 30d).
 * Invariant: Email stats must equal a direct SQL count of platform_email_log for the same range.
 */
export async function getPlatformChannelStats(
  rt: Runtime,
  platformStaffUserId: string,
  options: ChannelStatsOptions,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const { channel, range } = options;

  if (channel !== "email") {
    // SMS / WhatsApp in Slice A/B
    return {
      channel,
      range,
      sent: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      successRate: 100,
      daily: [],
    };
  }

  const intervalSql =
    range === "24h"
      ? sql`interval '24 hours'`
      : range === "30d"
        ? sql`interval '30 days'`
        : sql`interval '7 days'`;

  // Status counts - exact SQL matching
  const statusCounts = await db
    .select({
      status: schema.platformEmailLog.status,
      count: sql<string>`count(*)`,
    })
    .from(schema.platformEmailLog)
    .where(sql`${schema.platformEmailLog.createdAt} >= now() - ${intervalSql}`)
    .groupBy(schema.platformEmailLog.status);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of statusCounts) {
    const c = Number(row.count);
    if (row.status === "sent") sent = c;
    else if (row.status === "failed") failed = c;
    else if (row.status === "skipped") skipped = c;
  }
  const total = sent + failed + skipped;
  const attempted = sent + failed;
  const successRate = attempted > 0 ? Math.round((sent / attempted) * 100) : 100;

  // Daily breakdown in UTC
  const dailyRows = await db
    .select({
      day: sql<string>`to_char(${schema.platformEmailLog.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      status: schema.platformEmailLog.status,
      count: sql<string>`count(*)`,
    })
    .from(schema.platformEmailLog)
    .where(sql`${schema.platformEmailLog.createdAt} >= now() - ${intervalSql}`)
    .groupBy(sql`to_char(${schema.platformEmailLog.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, schema.platformEmailLog.status)
    .orderBy(sql`to_char(${schema.platformEmailLog.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);

  const dailyMap = new Map<string, { sent: number; failed: number; skipped: number }>();
  for (const r of dailyRows) {
    const existing = dailyMap.get(r.day) ?? { sent: 0, failed: 0, skipped: 0 };
    const c = Number(r.count);
    if (r.status === "sent") existing.sent += c;
    else if (r.status === "failed") existing.failed += c;
    else if (r.status === "skipped") existing.skipped += c;
    dailyMap.set(r.day, existing);
  }

  // Generate date labels covering the range
  const daysCount = range === "24h" ? 2 : range === "30d" ? 30 : 7;
  const daily: Array<{ date: string; sent: number; failed: number; skipped: number }> = [];
  const now = new Date();

  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dayStr = d.toISOString().slice(0, 10);
    const counts = dailyMap.get(dayStr) ?? { sent: 0, failed: 0, skipped: 0 };
    daily.push({
      date: dayStr,
      sent: counts.sent,
      failed: counts.failed,
      skipped: counts.skipped,
    });
  }

  return {
    channel,
    range,
    sent,
    failed,
    skipped,
    total,
    successRate,
    daily,
  };
}

/**
 * Gets paginated channel transactions with filters.
 */
export async function getPlatformChannelTransactions(
  rt: Runtime,
  platformStaffUserId: string,
  options: ChannelTransactionsOptions,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const { channel } = options;

  if (channel !== "email") {
    // In Slice A/B, SMS/WhatsApp have no records yet
    return {
      items: [],
      total: 0,
    };
  }

  const conditions: SQL[] = [];
  if (options.failedOnly) {
    conditions.push(eq(schema.platformEmailLog.status, "failed"));
  } else if (options.status) {
    conditions.push(eq(schema.platformEmailLog.status, options.status));
  }
  if (options.template) {
    conditions.push(eq(schema.platformEmailLog.template, options.template));
  }
  if (options.tenantId) {
    conditions.push(eq(schema.platformEmailLog.tenantId, options.tenantId));
  }
  if (options.search && options.search.trim()) {
    const term = `%${options.search.trim()}%`;
    const searchCond = or(
      ilike(schema.platformEmailLog.toEmail, term),
      ilike(schema.platformEmailLog.template, term),
    );
    if (searchCond) {
      conditions.push(searchCond);
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRes] = await db
    .select({ count: sql<string>`count(*)` })
    .from(schema.platformEmailLog)
    .where(whereClause);

  const total = Number(countRes?.count ?? 0);

  const rows = await db
    .select({
      id: schema.platformEmailLog.id,
      createdAt: schema.platformEmailLog.createdAt,
      recipient: schema.platformEmailLog.toEmail,
      template: schema.platformEmailLog.template,
      tenantId: schema.platformEmailLog.tenantId,
      tenantName: schema.tenants.name,
      status: schema.platformEmailLog.status,
      providerMessageId: schema.platformEmailLog.providerMessageId,
      error: schema.platformEmailLog.error,
    })
    .from(schema.platformEmailLog)
    .leftJoin(schema.tenants, eq(schema.platformEmailLog.tenantId, schema.tenants.id))
    .where(whereClause)
    .orderBy(desc(schema.platformEmailLog.createdAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  return {
    items: rows.map((r) => ({
      id: r.id,
      channel: "email" as const,
      createdAt: r.createdAt.toISOString(),
      recipient: r.recipient,
      template: r.template,
      tenantId: r.tenantId ?? null,
      tenantName: r.tenantName ?? null,
      status: r.status as "sent" | "failed" | "skipped",
      provider: "zoho_zeptomail",
      providerMessageId: r.providerMessageId ?? null,
      error: r.error ?? null,
    })),
    total,
  };
}
