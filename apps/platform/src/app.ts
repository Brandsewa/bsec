import { Hono } from "hono";
import { cors } from "hono/cors";
import { implement, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { platformContract } from "@bs/contracts";
import { createPlatformAuth, PLATFORM_COOKIE_PREFIX, type PlatformAuth } from "@bs/auth";
import {
  assertPlatformStaff,
  checkHealth,
  getPlatformTenant,
  getPlatformTenantDetail,
  listPlatformTenants,
  platformCreateTenantForClient,
  resendTenantOwnerInvite,
  getPlatformOverviewMetrics,
  suspendPlatformTenant,
  restorePlatformTenant,
  archivePlatformTenant,
  changePlatformTenantPlan,
  extendPlatformTenantTrial,
  transferPlatformTenantOwnership,
  addPlatformTenantNote,
  bulkSuspendPlatformTenants,
  bulkChangePlatformTenantTier,
  listPlatformStaffMembers,
  invitePlatformStaffMember,
  updatePlatformStaffRole,
  deactivatePlatformStaffMember,
  reactivatePlatformStaffMember,
  listPlatformAuditLogs,
  exportPlatformAuditLogsCsv,
  scheduleTenantDeletion,
  cancelTenantDeletion,
  startSupportSession,
  extendSupportSession,
  confirmSupportSessionWriteAccess,
  endSupportSession,
  listPlatformSupportSessions,
  runStoreExport,
  verifyExportSignature,
  getPlatformSystemData,
  retryFailedJob,
  retryFailedWebhook,
  writePlatformAudit,
  requestLogger,
  resolveRequestId,
  getClientIp,
  type Logger,
  type Runtime,
} from "@bs/domain";

export interface PlatformContext {
  rt: Runtime;
  log: Logger;
  session?: {
    user: { id: string; email?: string };
    type?: string;
  } | null;
  meta?: {
    ip?: string;
    userAgent?: string;
    requestId?: string;
  };
}

let _platformAuth: PlatformAuth | undefined;
export function getPlatformAuth(rt: Runtime): PlatformAuth {
  if (!_platformAuth) {
    _platformAuth = createPlatformAuth(rt._db.db, {
      baseURL: process.env.PLATFORM_AUTH_URL ?? process.env.BETTER_AUTH_URL,
      secret: process.env.BETTER_AUTH_SECRET,
      trustedOrigins: (process.env.SUPERADMIN_ORIGINS?.split(",") ?? [
        "http://localhost:5174",
        "https://platform.gobs.cloud",
      ]).map((s) => s.trim()),
      cookieDomain: process.env.COOKIE_DOMAIN,
    });
  }
  return _platformAuth;
}

const os = implement(platformContract).$context<PlatformContext>();

export const requirePlatformStaff = os.middleware(async ({ context, next }) => {
  if (!context.session || context.session.type === "customer") {
    throw new Error("Unauthorized: platform access requires authenticated staff credentials");
  }
  await assertPlatformStaff(context.rt, context.session.user.id);
  return next({ context });
});

export const platformRouter = os.router({
  system: {
    health: os.system.health.handler(({ context }) => checkHealth(context.rt)),
    data: os.system.data.use(requirePlatformStaff).handler(async ({ context }) => {
      const staffUserId = context.session!.user.id;
      return getPlatformSystemData(context.rt, staffUserId);
    }),
    retryJob: os.system.retryJob.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return retryFailedJob(context.rt, staffUserId, input.jobId, context.meta);
    }),
    retryWebhook: os.system.retryWebhook.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return retryFailedWebhook(context.rt, staffUserId, input.webhookId, context.meta);
    }),
  },
  overview: {
    get: os.overview.get.use(requirePlatformStaff).handler(async ({ context }) => {
      const staffUserId = context.session!.user.id;
      return getPlatformOverviewMetrics(context.rt, staffUserId);
    }),
  },
  tenants: {
    list: os.tenants.list.use(requirePlatformStaff).handler(({ context, input }) => {
      return listPlatformTenants(context.rt, input);
    }),
    get: os.tenants.get.use(requirePlatformStaff).handler(({ context, input }) => {
      return getPlatformTenant(context.rt, input.id);
    }),
    getDetail: os.tenants.getDetail.use(requirePlatformStaff).handler(({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return getPlatformTenantDetail(context.rt, staffUserId, input.id);
    }),
    create: os.tenants.create.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session?.user?.id;
      const res = await platformCreateTenantForClient(context.rt, input, staffUserId);
      return {
        tenantId: res.tenantId,
        slug: res.slug,
        hostname: res.hostname,
        storeUrl: res.storeUrl,
        adminUrl: res.adminUrl,
        inviteToken: res.inviteToken,
        inviteUrl: res.inviteUrl,
      };
    }),
    resendOwnerInvite: os.tenants.resendOwnerInvite.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session?.user?.id;
      const res = await resendTenantOwnerInvite(context.rt, {
        tenantId: input.id,
        email: input.email,
        staffUserId,
      });
      return {
        inviteId: res.inviteId,
        tenantId: res.tenantId,
        email: res.email,
        inviteToken: res.inviteToken,
        inviteUrl: res.inviteUrl,
      };
    }),
    suspend: os.tenants.suspend.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return suspendPlatformTenant(context.rt, staffUserId, input.id, input.reason, context.meta);
    }),
    restore: os.tenants.restore.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return restorePlatformTenant(context.rt, staffUserId, input.id, context.meta);
    }),
    archive: os.tenants.archive.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return archivePlatformTenant(context.rt, staffUserId, input.id, context.meta);
    }),
    changePlan: os.tenants.changePlan.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return changePlatformTenantPlan(context.rt, staffUserId, input.id, input.planCode, context.meta);
    }),
    extendTrial: os.tenants.extendTrial.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return extendPlatformTenantTrial(context.rt, staffUserId, input.id, input.additionalDays, context.meta);
    }),
    transferOwnership: os.tenants.transferOwnership.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return transferPlatformTenantOwnership(context.rt, staffUserId, input.id, input.newOwnerEmail, context.meta);
    }),
    addNote: os.tenants.addNote.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return addPlatformTenantNote(context.rt, staffUserId, input.id, input.body, context.meta);
    }),
    bulkSuspend: os.tenants.bulkSuspend.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return bulkSuspendPlatformTenants(context.rt, staffUserId, input.tenantIds, input.reason, context.meta);
    }),
    bulkChangeTier: os.tenants.bulkChangeTier.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return bulkChangePlatformTenantTier(context.rt, staffUserId, input.tenantIds, input.tier, context.meta);
    }),
    requestDeletion: os.tenants.requestDeletion.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      const res = await scheduleTenantDeletion(
        context.rt,
        staffUserId,
        {
          tenantId: input.id,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.graceDays !== undefined ? { graceDays: input.graceDays } : {}),
        },
        context.meta,
      );
      return {
        ok: true,
        deletionId: res.id,
        scheduledFor: res.scheduledFor,
      };
    }),
    cancelDeletion: os.tenants.cancelDeletion.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      await cancelTenantDeletion(context.rt, staffUserId, input.id, context.meta);
      return { ok: true };
    }),
    export: os.tenants.export.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return runStoreExport(context.rt, input.id, staffUserId);
    }),
  },
  domains: {
    list: os.domains.list.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const rows = await context.rt._db.db
        .select({
          id: schema.domains.id,
          tenantId: schema.domains.tenantId,
          hostname: schema.domains.hostname,
          type: schema.domains.type,
          isPrimary: schema.domains.isPrimary,
          status: schema.domains.status,
          sslStatus: schema.domains.sslStatus,
          failureReason: schema.domains.failureReason,
          createdAt: schema.domains.createdAt,
          tenantName: schema.tenants.name,
          tenantSlug: schema.tenants.slug,
        })
        .from(schema.domains)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.domains.tenantId))
        .orderBy(desc(schema.domains.createdAt))
        .limit(input?.limit ?? 100)
        .offset(input?.offset ?? 0);

      return rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        hostname: r.hostname,
        type: r.type,
        isPrimary: r.isPrimary,
        status: r.status,
        sslStatus: r.sslStatus,
        failureReason: r.failureReason,
        createdAt: r.createdAt.toISOString(),
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
      }));
    }),
  },
  plans: {
    list: os.plans.list.use(requirePlatformStaff).handler(async ({ context }) => {
      const plans = await context.rt._db.db.select().from(schema.plans);
      const subCounts = await context.rt._db.db
        .select({
          planId: schema.subscriptions.planId,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.status, "active"))
        .groupBy(schema.subscriptions.planId);

      const countMap = new Map(subCounts.map((s) => [s.planId, s.count]));

      return plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        priceMonthlyPaise: Number(p.priceMonthlyPaise),
        priceYearlyPaise: Number(p.priceYearlyPaise),
        activeSubscribersCount: countMap.get(p.id) ?? 0,
        features: p.limits,
      }));
    }),
    invoices: os.plans.invoices.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const rows = await context.rt._db.db
        .select({
          id: schema.platformInvoices.id,
          tenantId: schema.platformInvoices.tenantId,
          number: schema.platformInvoices.number,
          amountPaise: schema.platformInvoices.amountPaise,
          taxPaise: schema.platformInvoices.taxPaise,
          status: schema.platformInvoices.status,
          issuedAt: schema.platformInvoices.issuedAt,
          tenantName: schema.tenants.name,
        })
        .from(schema.platformInvoices)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.platformInvoices.tenantId))
        .orderBy(desc(schema.platformInvoices.issuedAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);

      return rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        number: r.number,
        amountPaise: Number(r.amountPaise),
        taxPaise: Number(r.taxPaise),
        status: r.status,
        issuedAt: r.issuedAt.toISOString(),
      }));
    }),
  },
  signups: {
    list: os.signups.list.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const rows = await context.rt._db.db
        .select()
        .from(schema.signupLeads)
        .orderBy(desc(schema.signupLeads.createdAt))
        .limit(input?.limit ?? 100)
        .offset(input?.offset ?? 0);

      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        phone: r.phone,
        name: r.name,
        businessName: r.businessName,
        desiredSlug: r.desiredSlug,
        industry: r.industry,
        source: r.source,
        step: r.step,
        createdAt: r.createdAt.toISOString(),
      }));
    }),
  },
  templates: {
    list: os.templates.list.use(requirePlatformStaff).handler(async ({ context }) => {
      const rows = await context.rt._db.db.select().from(schema.themeTemplates);
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        industry: r.industry,
        previewImageKey: r.previewImageKey,
        version: r.version,
        isActive: r.isActive,
      }));
    }),
  },
  support: {
    list: os.support.list.use(requirePlatformStaff).handler(async ({ context, input }) => {
      return listPlatformSupportSessions(context.rt, input?.tenantId);
    }),
    start: os.support.start.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return startSupportSession(context.rt, staffUserId, input, context.meta);
    }),
    extend: os.support.extend.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return extendSupportSession(context.rt, staffUserId, input.id, context.meta);
    }),
    elevateWrite: os.support.elevateWrite.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return confirmSupportSessionWriteAccess(context.rt, staffUserId, input.id, context.meta);
    }),
    end: os.support.end.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return endSupportSession(context.rt, staffUserId, input.id, context.meta);
    }),
  },
  quotas: {
    list: os.quotas.list.use(requirePlatformStaff).handler(async ({ context }) => {
      const rows = await context.rt._db.db.select().from(schema.quotaDefinitions);
      return rows.map((r) => ({
        key: r.key,
        description: r.description,
        unit: r.unit,
        enforcement: r.enforcement,
        tierXs: r.tierXs,
        tierS: r.tierS,
        tierM: r.tierM,
        tierL: r.tierL,
      }));
    }),
  },
  features: {
    list: os.features.list.use(requirePlatformStaff).handler(async ({ context }) => {
      const rows = await context.rt._db.db.select().from(schema.featureFlags);
      return rows.map((r) => ({
        key: r.key,
        defaultOn: r.defaultOn,
        killSwitch: r.killSwitch,
      }));
    }),
    update: os.features.update.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      await context.rt._db.db.transaction(async (tx) => {
        const updateValues: { defaultOn: boolean; killSwitch?: boolean; updatedAt: any } = {
          defaultOn: input.defaultOn,
          updatedAt: sql`now()`,
        };
        if (input.killSwitch !== undefined) {
          updateValues.killSwitch = input.killSwitch;
        }
        await tx
          .update(schema.featureFlags)
          .set(updateValues)
          .where(eq(schema.featureFlags.key, input.featureKey));

        await writePlatformAudit(
          tx,
          staffUserId,
          "feature_flag.update",
          "feature_flag",
          input.featureKey,
          null,
          updateValues,
          context.meta,
        );
      });
      return { ok: true };
    }),
  },
  staff: {
    list: os.staff.list.use(requirePlatformStaff).handler(async ({ context }) => {
      const staffUserId = context.session!.user.id;
      return listPlatformStaffMembers(context.rt, staffUserId);
    }),
    invite: os.staff.invite.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return invitePlatformStaffMember(context.rt, staffUserId, input, context.meta);
    }),
    updateRole: os.staff.updateRole.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return updatePlatformStaffRole(context.rt, staffUserId, input.userId, input.role, context.meta);
    }),
    deactivate: os.staff.deactivate.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return deactivatePlatformStaffMember(context.rt, staffUserId, input.userId, context.meta);
    }),
    reactivate: os.staff.reactivate.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return reactivatePlatformStaffMember(context.rt, staffUserId, input.userId, context.meta);
    }),
  },
  audit: {
    list: os.audit.list.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      return listPlatformAuditLogs(context.rt, staffUserId, input);
    }),
    exportCsv: os.audit.exportCsv.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = context.session!.user.id;
      const csv = await exportPlatformAuditLogsCsv(context.rt, staffUserId, input);
      return { csv };
    }),
  },
});

type Env = { Variables: { log: Logger } };

export function createApp(rt: Runtime, rootLog: Logger) {
  const logError = (error: unknown) => rootLog.error({ err: error }, "platform api error");
  const rpc = new RPCHandler(platformRouter, { interceptors: [onError(logError)] });
  const openapi = new OpenAPIHandler(platformRouter, { interceptors: [onError(logError)] });

  const app = new Hono<Env>();

  // CORS for Super Admin
  const allowedOrigins = [
    "http://localhost:5174",
    "http://localhost:5173",
    "https://platform.gobs.cloud",
    ...(process.env.SUPERADMIN_ORIGINS?.split(",").map((s) => s.trim()) ?? []),
  ];

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "*";
        if (allowedOrigins.includes(origin) || origin.endsWith(".gobs.cloud")) return origin;
        return null;
      },
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "Cookie",
        "X-Request-Id",
        "X-Support-Token",
        "X-Test-Staff-Id",
      ],
      exposeHeaders: ["X-Request-Id", "Set-Cookie"],
    }),
  );

  app.use("*", async (c, next) => {
    const requestId = resolveRequestId(c.req.header("x-request-id"));
    c.set("log", requestLogger(rootLog, requestId));
    await next();
    c.header("x-request-id", requestId);
  });

  // Better Auth endpoints for platform_staff
  app.all("/api/auth/*", async (c) => {
    const auth = getPlatformAuth(rt);
    return auth.handler(c.req.raw);
  });

  // Export download endpoint
  app.get("/api/platform/exports/:exportId/download", async (c) => {
    const exportId = c.req.param("exportId");
    const expires = Number(c.req.query("expires") ?? 0);
    const signature = c.req.query("signature") ?? "";

    if (!verifyExportSignature(exportId, expires, signature)) {
      return c.text("Unauthorized or expired export download link", 401);
    }

    const [rec] = await rt._db.db
      .select()
      .from(schema.exports)
      .where(eq(schema.exports.id, exportId))
      .limit(1);

    if (!rec) {
      return c.text("Export not found", 404);
    }

    return c.text(JSON.stringify(rec.metadata ?? {}, null, 2), 200, {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="export-${rec.tenantId}-${exportId}.json"`,
    });
  });

  app.get("/health", async (c) => {
    const h = await checkHealth(rt);
    return c.json(h, h.db.ok ? 200 : 503);
  });

  const buildContext = async (c: any): Promise<PlatformContext> => {
    const ip = getClientIp(c.req.raw.headers as Headers);
    const userAgent = c.req.header("user-agent");
    const requestId = resolveRequestId(c.req.header("x-request-id"));
    const meta = { ip, userAgent, requestId };

    const cookieHeader = c.req.header("cookie") ?? "";
    const testStaffId = c.req.header("x-test-staff-id");

    let session: PlatformContext["session"] = null;

    if (testStaffId && process.env.NODE_ENV !== "production") {
      session = { user: { id: testStaffId }, type: "platform_staff" };
    } else if (cookieHeader.includes(PLATFORM_COOKIE_PREFIX)) {
      try {
        const auth = getPlatformAuth(rt);
        const result = await auth.api.getSession({ headers: c.req.raw.headers });
        if (result) {
          session = {
            user: { id: result.user.id, email: result.user.email },
            type: "platform_staff",
          };
        }
      } catch {
        session = null;
      }
    }

    return {
      rt,
      log: c.get("log"),
      session,
      meta,
    };
  };

  app.all("/api/rpc/*", async (c, next) => {
    const context = await buildContext(c);
    const { matched, response } = await rpc.handle(c.req.raw, { prefix: "/api/rpc", context });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });

  app.all("/rpc/*", async (c, next) => {
    const context = await buildContext(c);
    const { matched, response } = await rpc.handle(c.req.raw, { prefix: "/rpc", context });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });

  app.all("/*", async (c, next) => {
    const context = await buildContext(c);
    const { matched, response } = await openapi.handle(c.req.raw, { context });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });

  return app;
}
