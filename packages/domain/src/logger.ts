import { pino, type Logger } from "pino";

/**
 * Structured logs with request_id and tenant_id on every line (PLAN §13 M0).
 * PII is not logged; redact paths cover the obvious fields.
 */
export function createLogger(service: string): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service, version: process.env.APP_VERSION ?? "dev" },
    redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token", "*.email", "*.phone"],
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export function requestLogger(root: Logger, requestId: string, tenantId?: string): Logger {
  return root.child({ request_id: requestId, tenant_id: tenantId ?? null });
}

/** Trust an inbound x-request-id only when it looks sane; otherwise mint one. */
export function resolveRequestId(header: string | null | undefined): string {
  return header && /^[\w-]{8,64}$/.test(header) ? header : crypto.randomUUID();
}

export type { Logger };
