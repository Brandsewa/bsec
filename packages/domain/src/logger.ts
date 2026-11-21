import { pino, type Logger } from "pino";

/**
 * Structured logs with request_id and tenant_id on every line (PLAN §13 M0).
 * PII is not logged; redact paths cover the obvious fields.
 */
/**
 * Field paths whose values never reach a log line (AGENTS.md rule 7, audit A6-01). pino's `*` matches one level, so the
 * list covers the places secrets actually turn up: request headers (also nested inside an error as `err.config.headers`
 * or `err.request.headers`), credentials and codes in bodies, and provider keys.
 */
export const LOG_REDACT_PATHS: string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-support-token']",
  "req.headers['x-razorpay-signature']",
  "req.headers['stripe-signature']",
  // pino paths are case-sensitive and HTTP client libraries write "Authorization", so both spellings are listed.
  "*.headers.authorization",
  "*.headers.Authorization",
  "*.headers.cookie",
  "*.headers.Cookie",
  "*.headers['set-cookie']",
  "*.headers['Set-Cookie']",
  "*.headers['x-support-token']",
  "*.headers['X-Support-Token']",
  "*.*.headers.authorization",
  "*.*.headers.Authorization",
  "*.*.headers.cookie",
  "*.*.headers.Cookie",
  "*.password",
  "*.token",
  "*.email",
  "*.phone",
  "*.secret",
  "*.keySecret",
  "*.clientSecret",
  "*.webhookSecret",
  "*.secretKey",
  "*.apiKey",
  "*.access_token",
  "*.refresh_token",
  "*.id_token",
  "*.otp",
  "*.code",
  "*.cardNumber",
  "*.cvv",
];

export function createLogger(service: string): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service, version: process.env.APP_VERSION ?? "dev" },
    redact: LOG_REDACT_PATHS,
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
