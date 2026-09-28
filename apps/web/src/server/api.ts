import "server-only";
import { Hono } from "hono";
import { implement, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { storeContract } from "@bs/contracts";
import { checkHealth, requestLogger, resolveRequestId, type Logger, type Runtime } from "@bs/domain";
import { server } from "./runtime.ts";

/**
 * Store API mounted inside Next at /api (PLAN §3). Route handlers never touch the DB:
 * procedures call domain services with the runtime. Tenant resolution arrives in M1.
 */
interface ApiContext {
  rt: Runtime;
  log: Logger;
}

const os = implement(storeContract).$context<ApiContext>();

export const storeRouter = os.router({
  system: {
    health: os.system.health.handler(({ context }) => checkHealth(context.rt)),
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
    context: { rt: server().rt, log: c.get("log") },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

api.all("/*", async (c, next) => {
  const { matched, response } = await openapi.handle(c.req.raw, {
    prefix: "/api",
    context: { rt: server().rt, log: c.get("log") },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});
