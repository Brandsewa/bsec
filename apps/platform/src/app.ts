import { Hono } from "hono";
import { cors } from "hono/cors";
import { implement, onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { platformContract } from "@bs/contracts";
import { createPlatformAuth, PLATFORM_COOKIE_PREFIX, type PlatformAuth } from "@bs/auth";
import {
  acceptPlatformStaffInvitation,
  listPlatformDomains,
  listPlatformFeatureFlags,
  listPlatformInvoices,
  listPlatformPlans,
  listPlatformQuotaDefinitions,
  listPlatformSignups,
  recordExportDownload,
  requestCustomDomainForClient,
  updatePlatformFeatureFlag,
  assertPlatformStaff,
  assertRoleAtLeast,
  checkHealth,
  checkInviteAcceptRateLimit,
  completePlatformMfaEnrollment,
  getPlatformLoginStatus,
  readExportArchive,
  type PlatformRole,
  type PlatformStaffIdentity,
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
  updatePlatformSettings,
  retryFailedJob,
  retryFailedWebhook,
  listThemeTemplates,
  getThemeTemplate,
  createThemeTemplate,
  saveThemeTemplateDraft,
  publishThemeTemplate,
  updateThemeTemplateMeta,
  getPlatformEmailSettings,
  getPlatformSettings,
  updatePlatformEmailSettings,
  sendPlatformTestEmail,
  listRecentEmailDeliveries,
  sendPlatformEmail,
  renderEmail,
  createLogger,
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
    /** When the Better Auth session was created. Must be after MFA enrolment completed. */
    createdAt?: Date;
  } | null | undefined;
  /** Set by requirePlatformStaff once the session, MFA and active-staff checks passed. */
  staff?: PlatformStaffIdentity;
  meta?: {
    ip?: string | undefined;
    userAgent?: string | undefined;
    requestId?: string | undefined;
  } | undefined;
}

/** Origins allowed to call the platform API with credentials. Exact matches only (tenants own *.bcom.si subdomains). */
export function platformAllowedOrigins(): string[] {
  const configured = (process.env.SUPERADMIN_ORIGINS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  return ["https://superadmin.bcom.si", ...(process.env.NODE_ENV !== "production" ? ["http://localhost:5174", "http://localhost:5173"] : [])];
}

const platformAuthLogger = createLogger("platform-auth");
let _platformAuth: PlatformAuth | undefined;
export function getPlatformAuth(rt: Runtime): PlatformAuth {
  if (!_platformAuth) {
    const superadminUrl = platformAllowedOrigins()[0] ?? "https://superadmin.bcom.si";
    _platformAuth = createPlatformAuth(rt._db.db, {
      baseURL: process.env.PLATFORM_AUTH_URL ?? process.env.BETTER_AUTH_URL,
      secret: process.env.BETTER_AUTH_SECRET,
      superadminUrl,
      trustedOrigins: platformAllowedOrigins(),
      // Host-only cookie by default. Never inherit the store COOKIE_DOMAIN: a platform cookie must not be shared with
      // tenant subdomains.
      cookieDomain: process.env.PLATFORM_COOKIE_DOMAIN,
      onSendResetPassword: async ({ user, url }) => {
        const brand = { storeName: "Brand Sewa Platform", baseUrl: superadminUrl };
        const { html, text } = renderEmail("password_reset", brand, { resetUrl: url }, "Reset your password");
        queueMicrotask(async () => {
          try {
            await sendPlatformEmail(rt._db.db, {
              to: user.email,
              subject: "Reset your password",
              html,
              text,
              fromName: "Brand Sewa Platform",
              template: "password_reset",
            });
          } catch (err) {
            platformAuthLogger.error({ err, email: user.email }, "Failed to send platform password reset email");
          }
        });
      },
      onPasswordReset: async ({ user }) => {
        const brand = { storeName: "Brand Sewa Platform", baseUrl: superadminUrl };
        const { html, text } = renderEmail("password_changed", brand, {}, "Your password was changed");
        queueMicrotask(async () => {
          try {
            await sendPlatformEmail(rt._db.db, {
              to: user.email,
              subject: "Your password was changed",
              html,
              text,
              fromName: "Brand Sewa Platform",
              template: "password_changed",
            });
          } catch (err) {
            platformAuthLogger.error({ err, email: user.email }, "Failed to send platform password changed email");
          }
        });
      },
    });
  }
  return _platformAuth;
}

/** Domain code signals problems with "Unauthorized:/Forbidden:/Bad Request:/Not Found:/Conflict:" prefixes. */
export function mapPlatformError(err: unknown): unknown {
  if (err instanceof Error && !(err instanceof ORPCError)) {
    const m = err.message;
    if (m.startsWith("Unauthorized")) return new ORPCError("UNAUTHORIZED", { message: m.replace(/^Unauthorized:\s*/, "") });
    if (m.startsWith("Forbidden")) return new ORPCError("FORBIDDEN", { message: m.replace(/^Forbidden:\s*/, "") });
    if (m.startsWith("Bad Request")) return new ORPCError("BAD_REQUEST", { message: m.replace(/^Bad Request:\s*/, "") });
    if (m.startsWith("Not Found")) return new ORPCError("NOT_FOUND", { message: m.replace(/^Not Found:\s*/, "") });
    if (m.startsWith("Conflict")) return new ORPCError("CONFLICT", { message: m.replace(/^Conflict:\s*/, "") });
    if (m.startsWith("Incorrect password")) return new ORPCError("FORBIDDEN", { message: m });
  }
  return err;
}

const os = implement(platformContract).$context<PlatformContext>();

/** The authenticated staff member's id. Only called after requireStaff() has run, which sets it. */
function actor(context: PlatformContext): string {
  if (!context.staff) throw new ORPCError("UNAUTHORIZED", { message: "Platform access requires authenticated staff credentials" });
  return context.staff.userId;
}

/**
 * Every platform procedure (except health) goes through this: a real session, an active platform_staff row,
 * completed and verified MFA, a session created after MFA enrolment (i.e. it went through password AND TOTP), and a
 * platform role of at least `min` (owner > admin > support).
 */
export const requireStaff = (min: PlatformRole = "platform_support") =>
  os.middleware(async ({ context, next }) => {
    try {
      if (!context.session || context.session.type === "customer") {
        throw new Error("Unauthorized: platform access requires authenticated staff credentials");
      }
      const staff = await assertPlatformStaff(context.rt, context.session.user.id, { createdAt: context.session.createdAt });
      assertRoleAtLeast(staff.role, min, "this action");
      return await next({ context: { ...context, staff } });
    } catch (err) {
      throw mapPlatformError(err);
    }
  });

export const requirePlatformStaff = requireStaff();

export const platformRouter = os.router({
  system: {
    health: os.system.health.handler(({ context }) => checkHealth(context.rt)),
    data: os.system.data.use(requirePlatformStaff).handler(async ({ context }) => {
      const staffUserId = actor(context);
      return getPlatformSystemData(context.rt, staffUserId);
    }),
    retryJob: os.system.retryJob.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return retryFailedJob(context.rt, staffUserId, input.jobId, context.meta);
    }),
    retryWebhook: os.system.retryWebhook.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return retryFailedWebhook(context.rt, staffUserId, input.webhookId, context.meta);
    }),
  },
  overview: {
    get: os.overview.get.use(requirePlatformStaff).handler(async ({ context }) => {
      const staffUserId = actor(context);
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
      const staffUserId = actor(context);
      return getPlatformTenantDetail(context.rt, staffUserId, input.id);
    }),
    create: os.tenants.create.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = context.session?.user?.id;
      const res = await platformCreateTenantForClient(context.rt, input, staffUserId);

      // An optional custom domain is requested right after the store exists (it talks to Cloudflare, so it is not part of the
      // database transaction). The store is complete either way and the outcome is reported honestly.
      const customDomain = input.customDomain?.trim()
        ? await requestCustomDomainForClient(context.rt, staffUserId, res.tenantId, input.customDomain)
        : undefined;

      return {
        tenantId: res.tenantId,
        slug: res.slug,
        hostname: res.hostname,
        storeUrl: res.storeUrl,
        adminUrl: res.adminUrl,
        inviteToken: res.inviteToken,
        inviteUrl: res.inviteUrl,
        ...(customDomain ? { customDomain } : {}),
      };
    }),
    resendOwnerInvite: os.tenants.resendOwnerInvite.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
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
    suspend: os.tenants.suspend.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return suspendPlatformTenant(context.rt, staffUserId, input.id, input.reason, context.meta);
    }),
    restore: os.tenants.restore.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return restorePlatformTenant(context.rt, staffUserId, input.id, context.meta);
    }),
    archive: os.tenants.archive.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return archivePlatformTenant(context.rt, staffUserId, input.id, context.meta);
    }),
    changePlan: os.tenants.changePlan.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return changePlatformTenantPlan(context.rt, staffUserId, input.id, input.planCode, context.meta);
    }),
    extendTrial: os.tenants.extendTrial.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return extendPlatformTenantTrial(context.rt, staffUserId, input.id, input.additionalDays, context.meta);
    }),
    transferOwnership: os.tenants.transferOwnership.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return transferPlatformTenantOwnership(context.rt, staffUserId, input.id, input.newOwnerEmail, context.meta);
    }),
    addNote: os.tenants.addNote.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return addPlatformTenantNote(context.rt, staffUserId, input.id, input.body, context.meta);
    }),
    bulkSuspend: os.tenants.bulkSuspend.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return bulkSuspendPlatformTenants(context.rt, staffUserId, input.tenantIds, input.reason, input.confirmation, context.meta);
    }),
    bulkChangeTier: os.tenants.bulkChangeTier.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return bulkChangePlatformTenantTier(context.rt, staffUserId, input.tenantIds, input.tier, input.confirmation, context.meta);
    }),
    requestDeletion: os.tenants.requestDeletion.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      const res = await scheduleTenantDeletion(
        context.rt,
        staffUserId,
        {
          tenantId: input.id,
          confirmSlug: input.confirmSlug,
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
    cancelDeletion: os.tenants.cancelDeletion.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      await cancelTenantDeletion(context.rt, staffUserId, input.id, context.meta);
      return { ok: true };
    }),
    export: os.tenants.export.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return runStoreExport(context.rt, input.id, staffUserId, { meta: context.meta });
    }),
  },
  domains: {
    list: os.domains.list.use(requirePlatformStaff).handler(({ context, input }) => listPlatformDomains(context.rt, input)),
  },
  plans: {
    list: os.plans.list.use(requirePlatformStaff).handler(({ context }) => listPlatformPlans(context.rt)),
    invoices: os.plans.invoices.use(requirePlatformStaff).handler(({ context, input }) => listPlatformInvoices(context.rt, input)),
  },
  signups: {
    list: os.signups.list.use(requirePlatformStaff).handler(({ context, input }) => listPlatformSignups(context.rt, input)),
  },
  templates: {
    list: os.templates.list.use(requirePlatformStaff).handler(({ context }) => {
      return listThemeTemplates(context.rt, actor(context));
    }),
    get: os.templates.get.use(requirePlatformStaff).handler(({ context, input }) => {
      return getThemeTemplate(context.rt, actor(context), input.code);
    }),
    create: os.templates.create.use(requireStaff("platform_admin")).handler(({ context, input }) => {
      return createThemeTemplate(context.rt, actor(context), input, context.meta);
    }),
    saveDraft: os.templates.saveDraft.use(requireStaff("platform_admin")).handler(({ context, input }) => {
      return saveThemeTemplateDraft(
        context.rt,
        actor(context),
        { code: input.code, pages: input.pages as never, tokens: input.tokens },
        context.meta,
      );
    }),
    publish: os.templates.publish.use(requireStaff("platform_admin")).handler(({ context, input }) => {
      return publishThemeTemplate(context.rt, actor(context), input.code, context.meta);
    }),
    updateMeta: os.templates.updateMeta.use(requireStaff("platform_admin")).handler(({ context, input }) => {
      return updateThemeTemplateMeta(context.rt, actor(context), input, context.meta);
    }),
  },
  support: {
    list: os.support.list.use(requirePlatformStaff).handler(async ({ context, input }) => {
      return listPlatformSupportSessions(context.rt, input?.tenantId);
    }),
    start: os.support.start.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return startSupportSession(context.rt, staffUserId, input, context.meta);
    }),
    extend: os.support.extend.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return extendSupportSession(context.rt, staffUserId, input.id, context.meta);
    }),
    elevateWrite: os.support.elevateWrite.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return confirmSupportSessionWriteAccess(context.rt, staffUserId, input.id, context.meta);
    }),
    end: os.support.end.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return endSupportSession(context.rt, staffUserId, input.id, context.meta);
    }),
  },
  quotas: {
    list: os.quotas.list.use(requirePlatformStaff).handler(({ context }) => listPlatformQuotaDefinitions(context.rt)),
  },
  features: {
    list: os.features.list.use(requirePlatformStaff).handler(({ context }) => listPlatformFeatureFlags(context.rt)),
    update: os.features.update.use(requireStaff("platform_admin")).handler(({ context, input }) =>
      updatePlatformFeatureFlag(context.rt, actor(context), input, context.meta),
    ),
  },
  staff: {
    list: os.staff.list.use(requireStaff("platform_admin")).handler(async ({ context }) => {
      const staffUserId = actor(context);
      return listPlatformStaffMembers(context.rt, staffUserId);
    }),
    invite: os.staff.invite.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return invitePlatformStaffMember(context.rt, staffUserId, input, context.meta);
    }),
    updateRole: os.staff.updateRole.use(requireStaff("platform_owner")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return updatePlatformStaffRole(context.rt, staffUserId, input.userId, input.role, context.meta);
    }),
    deactivate: os.staff.deactivate.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return deactivatePlatformStaffMember(context.rt, staffUserId, input.userId, context.meta);
    }),
    reactivate: os.staff.reactivate.use(requireStaff("platform_owner")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return reactivatePlatformStaffMember(context.rt, staffUserId, input.userId, context.meta);
    }),
  },
  audit: {
    list: os.audit.list.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return listPlatformAuditLogs(context.rt, staffUserId, input);
    }),
    exportCsv: os.audit.exportCsv.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      const csv = await exportPlatformAuditLogsCsv(context.rt, staffUserId, input);
      return { csv };
    }),
  },
  email: {
    get: os.email.get.use(requirePlatformStaff).handler(async ({ context }) => {
      const staffUserId = actor(context);
      return getPlatformEmailSettings(context.rt, staffUserId);
    }),
    update: os.email.update.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return updatePlatformEmailSettings(context.rt, staffUserId, input, context.meta);
    }),
    sendTest: os.email.sendTest.use(requireStaff("platform_admin")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return sendPlatformTestEmail(context.rt, staffUserId, input.toEmail, context.meta);
    }),
    recentDeliveries: os.email.recentDeliveries.use(requirePlatformStaff).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return listRecentEmailDeliveries(context.rt, staffUserId, input);
    }),
  },
  settings: {
    get: os.settings.get.use(requirePlatformStaff).handler(async ({ context }) => {
      const staffUserId = actor(context);
      return getPlatformSettings(context.rt, staffUserId);
    }),
    update: os.settings.update.use(requireStaff("platform_owner")).handler(async ({ context, input }) => {
      const staffUserId = actor(context);
      return updatePlatformSettings(context.rt, staffUserId, input, context.meta);
    }),
  },
});

type Env = { Variables: { log: Logger } };

/** Better Auth session for the platform cookie, or null. The cookie prefix keeps store cookies out of this path. */
async function readPlatformSession(rt: Runtime, headers: Headers): Promise<{ user: { id: string; email: string; name: string | null }; createdAt: Date } | null> {
  const cookieHeader = headers.get("cookie") ?? "";
  if (!cookieHeader.includes(PLATFORM_COOKIE_PREFIX)) return null;
  try {
    const result = await getPlatformAuth(rt).api.getSession({ headers });
    if (!result) return null;
    return {
      user: { id: result.user.id, email: result.user.email, name: result.user.name ?? null },
      createdAt: new Date(result.session.createdAt),
    };
  } catch {
    return null;
  }
}

export function createApp(rt: Runtime, rootLog: Logger) {
  const logError = (error: unknown) => rootLog.error({ err: error }, "platform api error");
  const rpc = new RPCHandler(platformRouter, { interceptors: [onError(logError)] });
  const openapi = new OpenAPIHandler(platformRouter, { interceptors: [onError(logError)] });

  const app = new Hono<Env>();
  const allowedOrigins = platformAllowedOrigins();

  // CORS: exact Super Admin origins only. Tenant stores live on other *.bcom.si subdomains and must never be
  // able to make credentialed calls here.
  app.use(
    "*",
    cors({
      origin: (origin) => (origin && allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-Request-Id"],
      exposeHeaders: ["X-Request-Id"],
    }),
  );

  app.use("*", async (c, next) => {
    const requestId = resolveRequestId(c.req.header("x-request-id"));
    c.set("log", requestLogger(rootLog, requestId));
    await next();
    c.header("x-request-id", requestId);
  });

  // CSRF: every state-changing request must carry an allowed Origin (browsers always send one on cross-origin and
  // same-site POSTs). A request from a tenant storefront page or from no origin at all is refused.
  app.use("*", async (c, next) => {
    const m = c.req.method;
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
      const origin = c.req.header("origin");
      if (!origin || !allowedOrigins.includes(origin)) {
        return c.json({ error: "Forbidden: request origin not allowed" }, 403);
      }
    }
    await next();
  });

  // Better Auth endpoints for platform_staff (sign-in, two-factor enrolment and verification, sign-out)
  app.all("/api/auth/*", async (c) => {
    const req = c.req.raw;
    const path = new URL(req.url).pathname;
    if (req.method === "POST" && path.endsWith("/change-password")) {
      const res = await getPlatformAuth(rt).handler(req);
      if (res.status === 200) {
        const session = await readPlatformSession(rt, c.req.raw.headers);
        if (session?.user?.email) {
          const email = session.user.email;
          const superadminUrl = platformAllowedOrigins()[0] ?? "https://superadmin.bcom.si";
          const brand = { storeName: "Brand Sewa Platform", baseUrl: superadminUrl };
          const { html, text } = renderEmail("password_changed", brand, {}, "Your password was changed");
          queueMicrotask(async () => {
            try {
              await sendPlatformEmail(rt._db.db, {
                to: email,
                subject: "Your password was changed",
                html,
                text,
                fromName: "Brand Sewa Platform",
                template: "password_changed",
              });
            } catch (err) {
              platformAuthLogger.error({ err, email }, "Failed to send platform password changed email");
            }
          });
        }
      }
      return res;
    }
    return getPlatformAuth(rt).handler(req);
  });

  /** Where this login stands: signed in? platform staff? MFA enrolled/complete? Usable before MFA is complete. */
  app.get("/api/platform/me", async (c) => {
    const session = await readPlatformSession(rt, c.req.raw.headers);
    if (!session) return c.json({ authenticated: false });
    const status = await getPlatformLoginStatus(rt, session.user.id, session.createdAt);
    return c.json({ authenticated: true, userId: session.user.id, email: session.user.email, name: session.user.name, ...status });
  });

  /**
   * Called after the first TOTP code was verified. Stamps enrolment as complete and ends every session of the user, so
   * the next sign-in is password + authenticator code.
   */
  app.post("/api/platform/mfa/complete", async (c) => {
    const session = await readPlatformSession(rt, c.req.raw.headers);
    if (!session) return c.json({ error: "Unauthorized: sign in first" }, 401);
    try {
      await completePlatformMfaEnrollment(rt, session.user.id, {
        ip: getClientIp(c.req.raw.headers),
        userAgent: c.req.header("user-agent"),
        requestId: resolveRequestId(c.req.header("x-request-id")),
      });
      return c.json({ ok: true, signInAgain: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed";
      return c.json({ error: message.replace(/^[A-Za-z ]+:\s*/, "") }, message.startsWith("Forbidden") ? 403 : 409);
    }
  });

  /** Public: accept a platform staff invitation (rate limited per IP and per token). */
  app.post("/api/platform/staff/accept-invitation", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: string; password?: string; name?: string };
    if (!body.token || !body.password) return c.json({ error: "Token and password are required" }, 400);
    const ip = getClientIp(c.req.raw.headers);
    const limit = await checkInviteAcceptRateLimit(rt._db.db, ip, body.token);
    if (!limit.allowed) return c.json({ error: "Too many attempts. Please try again later." }, 429);
    try {
      const res = await acceptPlatformStaffInvitation(
        rt,
        { token: body.token, password: body.password, name: body.name },
        { ip, userAgent: c.req.header("user-agent"), requestId: resolveRequestId(c.req.header("x-request-id")) },
      );
      return c.json(res);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to accept invitation" }, 400);
    }
  });

  /**
   * Export download. Needs BOTH a signed, expiring link (handed only to an authenticated admin) AND a current platform
   * session with MFA and the admin role; the download is audited.
   */
  app.get("/api/platform/exports/:exportId/download", async (c) => {
    const exportId = c.req.param("exportId");
    const expires = Number(c.req.query("expires") ?? 0);
    const signature = c.req.query("signature") ?? "";

    let signatureOk: boolean;
    try {
      signatureOk = verifyExportSignature(exportId, expires, signature);
    } catch {
      return c.text("Export downloads are not configured", 503);
    }
    if (!signatureOk) return c.text("Unauthorized or expired export download link", 401);

    const session = await readPlatformSession(rt, c.req.raw.headers);
    if (!session) return c.text("Unauthorized: sign in to download", 401);
    let staff: PlatformStaffIdentity;
    try {
      staff = await assertPlatformStaff(rt, session.user.id, { createdAt: session.createdAt });
      assertRoleAtLeast(staff.role, "platform_admin", "downloading an export");
    } catch {
      return c.text("Forbidden", 403);
    }

    const file = await readExportArchive(rt, exportId);
    if (!file) return c.text("Export not found or expired", 404);

    await recordExportDownload(rt, staff.userId, { exportId, tenantId: file.tenantId, sha256: file.sha256 }, { ip: getClientIp(c.req.raw.headers), userAgent: c.req.header("user-agent") });

    return c.body(new Uint8Array(file.data), 200, {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="store-export-${file.tenantId}-${exportId}.json.gz"`,
      "X-Content-SHA256": file.sha256,
      "Cache-Control": "no-store",
    });
  });

  app.get("/health", async (c) => {
    const h = await checkHealth(rt);
    return c.json(h, h.db.ok ? 200 : 503);
  });

  const buildContext = async (c: { req: { raw: Request; header: (n: string) => string | undefined }; get: (k: "log") => Logger }): Promise<PlatformContext> => {
    const meta = {
      ip: getClientIp(c.req.raw.headers as Headers),
      userAgent: c.req.header("user-agent"),
      requestId: resolveRequestId(c.req.header("x-request-id")),
    };

    let session: PlatformContext["session"] = null;
    const testStaffId = c.req.header("x-test-staff-id");
    // Test-only bypass: needs an explicit flag AND a non-production environment. Off everywhere by default.
    if (testStaffId && process.env.ALLOW_TEST_AUTH === "1" && process.env.NODE_ENV !== "production") {
      session = { user: { id: testStaffId }, type: "platform_staff", createdAt: new Date() };
    } else {
      const s = await readPlatformSession(rt, c.req.raw.headers);
      if (s) session = { user: { id: s.user.id, email: s.user.email }, type: "platform_staff", createdAt: s.createdAt };
    }

    return { rt, log: c.get("log"), session, meta };
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
