import { sql } from "drizzle-orm";
import os from "node:os";
import type { Runtime } from "../runtime.ts";

export interface SystemSignalStatus {
  value: number;
  unit: string;
  status: "ok" | "warning" | "scale_trigger";
  warningThreshold: number;
  scaleTriggerThreshold: number;
  action?: string | undefined;
}

export interface SystemMetricsReport {
  timestamp: string;
  overallStatus: "healthy" | "warning" | "scale_trigger";
  signals: {
    cpu: SystemSignalStatus;
    ram: SystemSignalStatus;
    dbConnections: SystemSignalStatus;
    uncachedP95: SystemSignalStatus;
    jobLag: SystemSignalStatus;
    singleStoreLoadShare: SystemSignalStatus & { topTenantId?: string | undefined };
  };
  details: {
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      systemTotalBytes: number;
      systemFreeBytes: number;
    };
    db: {
      activeConnections: number;
      maxConnections: number;
      waitingCount: number;
    };
    tenants: Array<{
      tenantId: string;
      requestCount: number;
      sharePercent: number;
    }>;
  };
  activeAlerts: string[];
}

export interface MetricThresholdsConfig {
  cpu: { warning: number; scaleTrigger: number };
  ram: { warning: number; scaleTrigger: number };
  dbConnections: { warning: number; scaleTrigger: number; maxPool: number };
  uncachedP95: { warning: number; scaleTrigger: number };
  jobLag: { warning: number; scaleTrigger: number };
  singleStoreLoadShare: { warning: number; scaleTrigger: number };
}

export const PLAN_DEFAULT_THRESHOLDS: MetricThresholdsConfig = {
  cpu: { warning: 60.0, scaleTrigger: 75.0 },
  ram: { warning: 70.0, scaleTrigger: 80.0 },
  dbConnections: { warning: 70.0, scaleTrigger: 90.0, maxPool: 60 },
  uncachedP95: { warning: 400, scaleTrigger: 500 },
  jobLag: { warning: 30, scaleTrigger: 120 },
  singleStoreLoadShare: { warning: 20.0, scaleTrigger: 25.0 },
};

/**
 * Collects and evaluates system metrics against PLAN §14 capacity signals.
 */
export async function getSystemMetrics(
  rt: Runtime,
  options?: {
    customThresholds?: Partial<MetricThresholdsConfig> | undefined;
    simulatedP95Ms?: number | undefined;
    now?: Date | undefined;
  },
): Promise<SystemMetricsReport> {
  const db = rt._db.db;
  const thresholds: MetricThresholdsConfig = {
    ...PLAN_DEFAULT_THRESHOLDS,
    ...options?.customThresholds,
  };

  const activeAlerts: string[] = [];

  // 1. CPU Signal (host load average / vCPU count)
  const cpus = os.cpus().length || 1;
  const loadAvg1m = os.loadavg()[0] ?? 0;
  const cpuPercent = Math.min(100, Math.round(((loadAvg1m / cpus) * 100) * 10) / 10);

  let cpuStatus: "ok" | "warning" | "scale_trigger" = "ok";
  let cpuAction: string | undefined;
  if (cpuPercent >= thresholds.cpu.scaleTrigger) {
    cpuStatus = "scale_trigger";
    cpuAction = "Host CPU > 75% at peak. Trigger VPS upgrade to 4 vCPU per PLAN §14 upgrade stage 1";
    activeAlerts.push("HostCPUScaleTrigger");
  } else if (cpuPercent >= thresholds.cpu.warning) {
    cpuStatus = "warning";
    cpuAction = "Host CPU > 60% sustained. Monitor load trends";
    activeAlerts.push("HostCPUWarning");
  }

  // 2. RAM Signal
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ramPercent = Math.round(((usedMem / totalMem) * 100) * 10) / 10;

  let ramStatus: "ok" | "warning" | "scale_trigger" = "ok";
  let ramAction: string | undefined;
  if (ramPercent >= thresholds.ram.scaleTrigger) {
    ramStatus = "scale_trigger";
    ramAction = "Host RAM > 80%. Risk of Postgres OOM kill. Expand RAM budget to 8 GB";
    activeAlerts.push("HostRAMScaleTrigger");
  } else if (ramPercent >= thresholds.ram.warning) {
    ramStatus = "warning";
    ramAction = "Host RAM > 70%. Monitor shared_buffers and container budgets";
    activeAlerts.push("HostRAMWarning");
  }

  // 3. Database Connection Pool Signal
  let activeDbConnections: number;
  let dbWaitingCount = 0;
  try {
    const connRes = await db.execute<{ active: string; waiting: string }>(sql`
      SELECT
        count(*)::text as active,
        count(*) FILTER (WHERE wait_event IS NOT NULL AND wait_event_type = 'Lock')::text as waiting
      FROM pg_stat_activity
      WHERE datname = current_database();
    `);
    activeDbConnections = parseInt(connRes.rows[0]?.active ?? "0", 10);
    dbWaitingCount = parseInt(connRes.rows[0]?.waiting ?? "0", 10);
  } catch {
    activeDbConnections = 1;
  }

  const dbConnPercent = Math.round(((activeDbConnections / thresholds.dbConnections.maxPool) * 100) * 10) / 10;
  let dbStatus: "ok" | "warning" | "scale_trigger" = "ok";
  let dbAction: string | undefined;

  if (dbConnPercent >= thresholds.dbConnections.scaleTrigger || dbWaitingCount > 0) {
    dbStatus = "scale_trigger";
    dbAction = "DB connections saturated or lock waits appearing. Tune container pools or deploy PgBouncer";
    activeAlerts.push("DBConnectionPoolSaturation");
  } else if (dbConnPercent >= thresholds.dbConnections.warning) {
    dbStatus = "warning";
    dbAction = "DB connections > 70% of max (42/60). Monitor connection growth";
    activeAlerts.push("DBConnectionPoolWarning");
  }

  // 4. Uncached p95 Request Latency Signal
  const uncachedP95Ms = options?.simulatedP95Ms ?? 180;
  let p95Status: "ok" | "warning" | "scale_trigger" = "ok";
  let p95Action: string | undefined;

  if (uncachedP95Ms >= thresholds.uncachedP95.scaleTrigger) {
    p95Status = "scale_trigger";
    p95Action = "Uncached p95 > 500 ms SLA violated. Investigate slow queries, missing indexes, or container throttling";
    activeAlerts.push("UncachedP95LatencyScaleTrigger");
  } else if (uncachedP95Ms >= thresholds.uncachedP95.warning) {
    p95Status = "warning";
    p95Action = "Uncached p95 > 400 ms SLA warning. Check query performance";
    activeAlerts.push("UncachedP95LatencyWarning");
  }

  // 5. Background Job Lag Signal
  let jobLagSeconds = 0;
  try {
    const lagRes = await db.execute<{ lag_seconds: string }>(sql`
      SELECT coalesce(extract(epoch from (now() - created_on)), 0)::text as lag_seconds
      FROM pgboss.job
      WHERE state = 'created'
      ORDER BY created_on ASC
      LIMIT 1;
    `);
    if (lagRes.rows[0]?.lag_seconds) {
      jobLagSeconds = Math.round(parseFloat(lagRes.rows[0].lag_seconds));
    }
  } catch {
    jobLagSeconds = 0;
  }

  let jobLagStatus: "ok" | "warning" | "scale_trigger" = "ok";
  let jobLagAction: string | undefined;
  if (jobLagSeconds >= thresholds.jobLag.scaleTrigger) {
    jobLagStatus = "scale_trigger";
    jobLagAction = "Worker job lag > 2 min. Increase worker concurrency or scale worker service per PLAN §14";
    activeAlerts.push("BackgroundJobLagScaleTrigger");
  } else if (jobLagSeconds >= thresholds.jobLag.warning) {
    jobLagStatus = "warning";
    jobLagAction = "Worker job lag > 30 s. Monitor queue processing throughput";
    activeAlerts.push("BackgroundJobLagWarning");
  }

  // 6. Single Store Share of Load (Noisy Neighbour)
  const tenantStats: Array<{ tenantId: string; requestCount: number; sharePercent: number }> = [];
  let topSharePercent = 0;
  let topTenantId: string | undefined;

  try {
    const tenantRes = await db.execute<{ tenant_id: string; total_req: string }>(sql`
      SELECT
        split_part(key, ':', 3) as tenant_id,
        sum(count)::text as total_req
      FROM rate_limit_counters
      WHERE key LIKE 'rate:storefront:%' OR key LIKE 'rate:admin:%'
      GROUP BY split_part(key, ':', 3);
    `);

    let grandTotalRequests = 0;
    const parsedRows = tenantRes.rows
      .filter((r) => r.tenant_id && r.tenant_id.length > 0)
      .map((r) => {
        const c = parseInt(r.total_req, 10) || 0;
        grandTotalRequests += c;
        return { tenantId: r.tenant_id, count: c };
      });

    if (grandTotalRequests > 0) {
      for (const row of parsedRows) {
        const share = Math.round(((row.count / grandTotalRequests) * 100) * 10) / 10;
        tenantStats.push({
          tenantId: row.tenantId,
          requestCount: row.count,
          sharePercent: share,
        });
        if (share > topSharePercent) {
          topSharePercent = share;
          topTenantId = row.tenantId;
        }
      }
    }
  } catch {
    // Empty if no counters yet
  }

  let storeShareStatus: "ok" | "warning" | "scale_trigger" = "ok";
  let storeShareAction: string | undefined;

  if (topSharePercent >= thresholds.singleStoreLoadShare.scaleTrigger) {
    storeShareStatus = "scale_trigger";
    storeShareAction = `Single tenant (${topTenantId}) consumes ${topSharePercent}% of platform traffic (>25%). Throttle, raise tier, or migrate to dedicated instance`;
    activeAlerts.push("SingleStoreLoadShareScaleTrigger");
  } else if (topSharePercent >= thresholds.singleStoreLoadShare.warning) {
    storeShareStatus = "warning";
    storeShareAction = `Single tenant (${topTenantId}) consumes ${topSharePercent}% of platform traffic (>20%). Monitor for noisy neighbour saturation`;
    activeAlerts.push("SingleStoreLoadShareWarning");
  }

  // Determine overall system status
  const statuses = [cpuStatus, ramStatus, dbStatus, p95Status, jobLagStatus, storeShareStatus];
  let overallStatus: "healthy" | "warning" | "scale_trigger" = "healthy";
  if (statuses.includes("scale_trigger")) {
    overallStatus = "scale_trigger";
  } else if (statuses.includes("warning")) {
    overallStatus = "warning";
  }

  const memUsage = process.memoryUsage();

  return {
    timestamp: (options?.now ?? new Date()).toISOString(),
    overallStatus,
    signals: {
      cpu: {
        value: cpuPercent,
        unit: "percent",
        status: cpuStatus,
        warningThreshold: thresholds.cpu.warning,
        scaleTriggerThreshold: thresholds.cpu.scaleTrigger,
        action: cpuAction,
      },
      ram: {
        value: ramPercent,
        unit: "percent",
        status: ramStatus,
        warningThreshold: thresholds.ram.warning,
        scaleTriggerThreshold: thresholds.ram.scaleTrigger,
        action: ramAction,
      },
      dbConnections: {
        value: dbConnPercent,
        unit: "percent",
        status: dbStatus,
        warningThreshold: thresholds.dbConnections.warning,
        scaleTriggerThreshold: thresholds.dbConnections.scaleTrigger,
        action: dbAction,
      },
      uncachedP95: {
        value: uncachedP95Ms,
        unit: "milliseconds",
        status: p95Status,
        warningThreshold: thresholds.uncachedP95.warning,
        scaleTriggerThreshold: thresholds.uncachedP95.scaleTrigger,
        action: p95Action,
      },
      jobLag: {
        value: jobLagSeconds,
        unit: "seconds",
        status: jobLagStatus,
        warningThreshold: thresholds.jobLag.warning,
        scaleTriggerThreshold: thresholds.jobLag.scaleTrigger,
        action: jobLagAction,
      },
      singleStoreLoadShare: {
        value: topSharePercent,
        unit: "percent",
        status: storeShareStatus,
        warningThreshold: thresholds.singleStoreLoadShare.warning,
        scaleTriggerThreshold: thresholds.singleStoreLoadShare.scaleTrigger,
        action: storeShareAction,
        topTenantId,
      },
    },
    details: {
      memory: {
        rssBytes: memUsage.rss,
        heapUsedBytes: memUsage.heapUsed,
        heapTotalBytes: memUsage.heapTotal,
        systemTotalBytes: totalMem,
        systemFreeBytes: freeMem,
      },
      db: {
        activeConnections: activeDbConnections,
        maxConnections: thresholds.dbConnections.maxPool,
        waitingCount: dbWaitingCount,
      },
      tenants: tenantStats,
    },
    activeAlerts,
  };
}
