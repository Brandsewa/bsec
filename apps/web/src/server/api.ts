import "server-only";
import { Hono } from "hono";
import { implement, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { storeContract } from "@bs/contracts";
import {
  buildTenantContext,
  checkHealth,
  getStoreSettings,
  inviteStaff,
  listMemberships,
  listStoreFeatureFlags,
  requestLogger,
  resolveRequestId,
  updateStoreSettings,
  type Logger,
  type Runtime,
  type TenantContext,
} from "@bs/domain";
import { server } from "./runtime.ts";

/**
 * Store API mounted inside Next at /api (PLAN §3). Route handlers never touch the DB:
 * procedures call domain services with the runtime and TenantContext.
 */
export interface ApiContext {
  rt: Runtime;
  log: Logger;
  headers?: Headers | undefined;
  session?: {
    user: { id: string; email?: string | undefined };
    session?: { id: string; userId: string; [key: string]: unknown } | undefined;
    type?: "staff" | "customer" | undefined;
  } | null | undefined;
  tenantCtx?: TenantContext | undefined;
}

const os = implement(storeContract).$context<ApiContext>();

const requireAdmin = os.middleware(async ({ context, next }) => {
  const headers = context.headers ?? new Headers();
  const tenantCtx = await buildTenantContext(context.rt, {
    entryPath: "admin",
    headers,
    session: context.session,
  });

  if (!tenantCtx) {
    throw new Error("Unauthorized: unable to resolve admin tenant context");
  }

  return next({
    context: {
      ...context,
      tenantCtx,
    },
  });
});

export const storeRouter = os.router({
  system: {
    health: os.system.health.handler(({ context }) => checkHealth(context.rt)),
  },
  admin: {
    memberships: {
      list: os.admin.memberships.list.use(requireAdmin).handler(({ context }) => {
        if (!context.tenantCtx) throw new Error("Missing tenant context");
        return listMemberships(context.rt, context.tenantCtx);
      }),
      invite: os.admin.memberships.invite.use(requireAdmin).handler(({ context, input }) => {
        if (!context.tenantCtx) throw new Error("Missing tenant context");
        return inviteStaff(context.rt, context.tenantCtx, input);
      }),
    },
    settings: {
      get: os.admin.settings.get.use(requireAdmin).handler(({ context }) => {
        if (!context.tenantCtx) throw new Error("Missing tenant context");
        return getStoreSettings(context.rt, context.tenantCtx);
      }),
      update: os.admin.settings.update.use(requireAdmin).handler(({ context, input }) => {
        if (!context.tenantCtx) throw new Error("Missing tenant context");
        return updateStoreSettings(context.rt, context.tenantCtx, input);
      }),
    },
    featureFlags: {
      list: os.admin.featureFlags.list.use(requireAdmin).handler(({ context }) => {
        if (!context.tenantCtx) throw new Error("Missing tenant context");
        return listStoreFeatureFlags(context.rt, context.tenantCtx);
      }),
    },
  },
});

const logError = (error: unknown) => server().log.error({ err: error }, "store api error");
const rpc = new RPCHandler(storeRouter, { interceptors: [onError(logError)] });
const openapi = new OpenAPIHandler(storeRouter, { interceptors: [onError(logError)] });

type Env = { Variables: { requestId: string; log: Logger } };

export const api = new Hono<Env>().basePath("/api");

api.use("*", async (c, next) => {
  const requestId = resolveRequestId(c.req.header("x-request-id"));
  c.set("requestId", requestId);
  c.set("log", requestLogger(server().log, requestId));
  await next();
  c.header("x-request-id", requestId);
});

/** Liveness + DB readiness, used by Docker/Coolify health checks. */
api.get("/health", async (c) => {
  const h = await checkHealth(server().rt);
  return c.json(h, h.db.ok ? 200 : 503);
});

api.all("/rpc/*", async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, {
    prefix: "/api/rpc",
    context: { rt: server().rt, log: c.get("log"), headers: c.req.raw.headers },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

api.all("/*", async (c, next) => {
  const { matched, response } = await openapi.handle(c.req.raw, {
    prefix: "/api",
    context: { rt: server().rt, log: c.get("log"), headers: c.req.raw.headers },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});
