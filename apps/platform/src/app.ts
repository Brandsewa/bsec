import { Hono } from "hono";
import { implement, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { platformContract } from "@bs/contracts";
import {
  assertPlatformStaff,
  checkHealth,
  getPlatformTenant,
  listPlatformTenants,
  requestLogger,
  resolveRequestId,
  type Logger,
  type Runtime,
} from "@bs/domain";

/**
 * Platform API (PLAN §3, §6). Its own container, its own credentials (app_platform, BYPASSRLS).
 * Private: platform.bscommerce.in behind Cloudflare Access. From M1 every procedure requires
 * platform_staff + MFA and writes platform_audit_logs; it exposes named platform functions only.
 */
export interface PlatformContext {
  rt: Runtime;
  log: Logger;
  session?: {
    user: { id: string };
    type?: string;
  } | null;
}

const os = implement(platformContract).$context<PlatformContext>();

const requirePlatformStaff = os.middleware(async ({ context, next }) => {
  if (!context.session || context.session.type === "customer") {
    throw new Error("Unauthorized: platform access requires authenticated staff credentials");
  }
  await assertPlatformStaff(context.rt, context.session.user.id);
  return next({ context });
});

export const platformRouter = os.router({
  system: {
    health: os.system.health.handler(({ context }) => checkHealth(context.rt)),
  },
  tenants: {
    list: os.tenants.list.use(requirePlatformStaff).handler(({ context }) => {
      return listPlatformTenants(context.rt);
    }),
    get: os.tenants.get.use(requirePlatformStaff).handler(({ context, input }) => {
      return getPlatformTenant(context.rt, input.id);
    }),
  },
});

type Env = { Variables: { log: Logger } };

export function createApp(rt: Runtime, rootLog: Logger) {
  const logError = (error: unknown) => rootLog.error({ err: error }, "platform api error");
  const rpc = new RPCHandler(platformRouter, { interceptors: [onError(logError)] });
  const openapi = new OpenAPIHandler(platformRouter, { interceptors: [onError(logError)] });

  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const requestId = resolveRequestId(c.req.header("x-request-id"));
    c.set("log", requestLogger(rootLog, requestId));
    await next();
    c.header("x-request-id", requestId);
  });

  app.get("/health", async (c) => {
    const h = await checkHealth(rt);
    return c.json(h, h.db.ok ? 200 : 503);
  });

  app.all("/rpc/*", async (c, next) => {
    const { matched, response } = await rpc.handle(c.req.raw, { prefix: "/rpc", context: { rt, log: c.get("log") } });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });

  app.all("/*", async (c, next) => {
    const { matched, response } = await openapi.handle(c.req.raw, { context: { rt, log: c.get("log") } });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });

  return app;
}
