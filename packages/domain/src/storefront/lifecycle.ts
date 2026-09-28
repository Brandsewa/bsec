import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@bs/db";
import { schema } from "@bs/db";
import { resolveHostToTenant } from "../host-resolver.ts";
import type { HeaderValues, TenantContext } from "../context.ts";
import type { Runtime } from "../runtime.ts";

export type StorefrontMode = "live" | "coming_soon" | "maintenance" | "password";

export type StorefrontAccessReason =
  | "not_found"
  | "provisioning"
  | "suspended"
  | "coming_soon"
  | "maintenance"
  | "password_required";

export interface StorefrontAccessResult {
  allowed: boolean;
  httpStatus: 200 | 404 | 503;
  reason?: StorefrontAccessReason | undefined;
  status?: string | undefined;
  mode?: StorefrontMode | undefined;
  tenantId?: string | undefined;
  tenantStatus?: string | undefined;
  isBypass?: boolean | undefined;
  isPasswordUnlocked?: boolean | undefined;
  noindex?: boolean | undefined;
  retryAfterSeconds?: number | undefined;
  message?: string | undefined;
  headline?: string | null | undefined;
  launchAt?: Date | null | undefined;
  showCountdown?: boolean | undefined;
  collectEmails?: boolean | undefined;
}

export interface StorefrontAccessOptions {
  headers?: HeaderValues;
  session?: {
    user: { id: string; email?: string | undefined };
    session?: { id: string; userId: string; [key: string]: unknown } | undefined;
    type?: "staff" | "customer" | undefined;
  } | null | undefined;
  cookies?: Record<string, string | undefined> | string | undefined;
  searchParams?: Record<string, string | string[] | undefined> | URLSearchParams | undefined;
  previewToken?: string | undefined;
  password?: string | undefined;
}

function getHeader(headers?: HeaderValues, name?: string): string | undefined {
  if (!headers || !name) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const lowerName = name.toLowerCase();
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lowerName) {
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}

function parseCookies(
  cookies?: Record<string, string | undefined> | string,
  headers?: HeaderValues,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (cookies && typeof cookies === "object") {
    for (const [k, v] of Object.entries(cookies)) {
      if (typeof v === "string") result[k] = v;
    }
  }
  const rawCookie =
    typeof cookies === "string"
      ? cookies
      : headers
        ? getHeader(headers, "cookie")
        : undefined;

  if (rawCookie) {
    const parts = rawCookie.split(";");
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx !== -1) {
        const key = part.slice(0, eqIdx).trim();
        const val = part.slice(eqIdx + 1).trim();
        if (key && !(key in result)) {
          try {
            result[key] = decodeURIComponent(val);
          } catch {
            result[key] = val;
          }
        }
      }
    }
  }
  return result;
}

function getQueryParam(
  searchParams?: Record<string, string | string[] | undefined> | URLSearchParams,
  name?: string,
): string | undefined {
  if (!searchParams || !name) return undefined;
  if (typeof (searchParams as URLSearchParams).get === "function") {
    return (searchParams as URLSearchParams).get(name) ?? undefined;
  }
  const record = searchParams as Record<string, string | string[] | undefined>;
  const val = record[name];
  if (Array.isArray(val)) return val[0];
  return val;
}

/**
 * Hashes a plaintext store password using SHA-256.
 */
export async function hashStorePassword(plain: string): Promise<string> {
  return createHash("sha256").update(plain).digest("hex");
}

/**
 * Verifies a plaintext store password against a stored SHA-256 hash or plain string.
 */
export async function verifyStorePassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  if (plain === hash) return true;
  const computed = createHash("sha256").update(plain).digest("hex");
  if (computed === hash) return true;
  return false;
}

/**
 * Hashes a preview bypass token using SHA-256.
 */
export function hashBypassToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Verifies a preview bypass token against a stored token hash or plain token.
 */
export function verifyBypassToken(token: string, hash: string): boolean {
  if (!token || !hash) return false;
  if (token === hash) return true;
  const computed = hashBypassToken(token);
  if (computed.length === hash.length) {
    try {
      return timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
    } catch {
      return computed === hash;
    }
  }
  return computed === hash;
}

/**
 * Evaluates storefront access according to the 5-stage request pipeline (PLAN §6.4 & §8.2):
 * 1. Host resolution
 * 2. Tenant lifecycle check
 * 3. Store status mode check (live, coming_soon, maintenance, password) & bypass check
 * 4. SEO & Robots policy enforcement
 */
export async function evaluateStorefrontAccess(
  dbOrRt: Db | Runtime,
  rawHost: string,
  opts?: StorefrontAccessOptions,
): Promise<StorefrontAccessResult> {
  const db = "_db" in dbOrRt ? dbOrRt._db.db : dbOrRt;

  // 1. Host Resolution
  const resolved = await resolveHostToTenant(db, rawHost);
  if (!resolved) {
    return {
      allowed: false,
      httpStatus: 404,
      reason: "not_found",
      status: "not_found",
    };
  }

  const { tenantId, tenantStatus } = resolved;

  // 2. Tenant Lifecycle Check (PLAN §6.4)
  if (tenantStatus === "provisioning") {
    return {
      allowed: false,
      httpStatus: 503,
      reason: "provisioning",
      status: "provisioning",
      tenantId,
      tenantStatus,
      message: "Store is being provisioned",
    };
  }

  if (tenantStatus === "suspended") {
    return {
      allowed: false,
      httpStatus: 503,
      reason: "suspended",
      status: "suspended",
      tenantId,
      tenantStatus,
      message: "This store is temporarily unavailable",
    };
  }

  if (
    tenantStatus === "archived" ||
    tenantStatus === "deletion_requested" ||
    tenantStatus === "deleted"
  ) {
    return {
      allowed: false,
      httpStatus: 404,
      reason: "not_found",
      status: "not_found",
      tenantId,
      tenantStatus,
    };
  }

  if (
    tenantStatus !== "active" &&
    tenantStatus !== "trial" &&
    tenantStatus !== "past_due"
  ) {
    return {
      allowed: false,
      httpStatus: 404,
      reason: "not_found",
      status: "not_found",
      tenantId,
      tenantStatus,
    };
  }

  // 3. Store Status Mode Check (PLAN §8.2)
  let statusRow:
    | {
        mode?: string | null;
        headline?: string | null;
        messageJson?: unknown;
        launchAt?: Date | null;
        showCountdown?: boolean | null;
        collectEmails?: boolean | null;
        passwordHash?: string | null;
        retryAfterMinutes?: number | null;
        bypassTokenHash?: string | null;
      }
    | undefined = undefined;

  try {
    const rows = await db
      .select({
        mode: schema.storeStatus.mode,
        headline: schema.storeStatus.headline,
        messageJson: schema.storeStatus.messageJson,
        launchAt: schema.storeStatus.launchAt,
        showCountdown: schema.storeStatus.showCountdown,
        collectEmails: schema.storeStatus.collectEmails,
        passwordHash: schema.storeStatus.passwordHash,
        retryAfterMinutes: schema.storeStatus.retryAfterMinutes,
        bypassTokenHash: schema.storeStatus.bypassTokenHash,
      })
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, tenantId))
      .limit(1);

    statusRow = rows[0];
  } catch {
    // Gracefully handle unconfigured or mocked db
  }

  const mode: StorefrontMode = (statusRow?.mode as StorefrontMode) ?? "coming_soon";

  // 4. SEO & Robots Policy (PLAN §8.3)
  let indexingEnabled = true;
  try {
    const seoRows = await db
      .select({
        indexingEnabled: schema.seoSettings.indexingEnabled,
      })
      .from(schema.seoSettings)
      .where(eq(schema.seoSettings.tenantId, tenantId))
      .limit(1);

    if (seoRows[0] && typeof seoRows[0].indexingEnabled === "boolean") {
      indexingEnabled = seoRows[0].indexingEnabled;
    }
  } catch {
    // Default indexing enabled if not configured
  }

  const cookies = parseCookies(opts?.cookies, opts?.headers);

  // Check Staff Session or Preview Token Bypass
  const isStaff = opts?.session?.type === "staff";

  const bypassTokenHash = statusRow?.bypassTokenHash;
  const candidatePreviewToken =
    opts?.previewToken ??
    getQueryParam(opts?.searchParams, "preview_token") ??
    cookies["bs_preview"];

  const isTokenBypass =
    !!bypassTokenHash &&
    !!candidatePreviewToken &&
    verifyBypassToken(candidatePreviewToken, bypassTokenHash);

  const isBypass = isStaff || isTokenBypass;

  const noindex = !indexingEnabled || mode === "coming_soon" || mode === "password";

  if (isBypass) {
    return {
      allowed: true,
      httpStatus: 200,
      mode,
      tenantId,
      tenantStatus,
      isBypass: true,
      noindex,
      headline: statusRow?.headline ?? null,
      launchAt: statusRow?.launchAt ?? null,
      showCountdown: statusRow?.showCountdown ?? false,
      collectEmails: statusRow?.collectEmails ?? true,
    };
  }

  // Modes for regular visitors
  if (mode === "live") {
    return {
      allowed: true,
      httpStatus: 200,
      mode: "live",
      tenantId,
      tenantStatus,
      noindex: !indexingEnabled,
    };
  }

  if (mode === "coming_soon") {
    return {
      allowed: false,
      reason: "coming_soon",
      status: "coming_soon",
      httpStatus: 200,
      mode: "coming_soon",
      tenantId,
      tenantStatus,
      noindex: true,
      headline: statusRow?.headline ?? null,
      launchAt: statusRow?.launchAt ?? null,
      showCountdown: statusRow?.showCountdown ?? false,
      collectEmails: statusRow?.collectEmails ?? true,
    };
  }

  if (mode === "maintenance") {
    const retryAfterMinutes = statusRow?.retryAfterMinutes ?? 60;
    return {
      allowed: false,
      reason: "maintenance",
      status: "maintenance",
      httpStatus: 503,
      mode: "maintenance",
      tenantId,
      tenantStatus,
      retryAfterSeconds: retryAfterMinutes * 60,
      message:
        typeof statusRow?.messageJson === "string" ? statusRow.messageJson : undefined,
    };
  }

  if (mode === "password") {
    const candidatePassword = opts?.password ?? cookies["bs_store_password"];
    const passwordHash = statusRow?.passwordHash;

    const passwordMatches =
      !!passwordHash &&
      !!candidatePassword &&
      (await verifyStorePassword(candidatePassword, passwordHash));

    if (passwordMatches) {
      return {
        allowed: true,
        httpStatus: 200,
        mode: "password",
        tenantId,
        tenantStatus,
        isPasswordUnlocked: true,
        noindex: true,
      };
    }

    return {
      allowed: false,
      reason: "password_required",
      status: "password_required",
      httpStatus: 200,
      mode: "password",
      tenantId,
      tenantStatus,
      noindex: true,
    };
  }

  return {
    allowed: false,
    reason: "coming_soon",
    status: "coming_soon",
    httpStatus: 200,
    mode: "coming_soon",
    tenantId,
    tenantStatus,
    noindex: true,
  };
}

/**
 * Verifies a password against the tenant's store status password_hash.
 */
export async function verifyStorefrontPassword(
  rt: Runtime,
  ctx: TenantContext,
  password: string,
): Promise<{ success: boolean; token?: string | undefined }> {
  const db = rt._db.db;
  const rows = await db
    .select({ passwordHash: schema.storeStatus.passwordHash })
    .from(schema.storeStatus)
    .where(eq(schema.storeStatus.tenantId, ctx.tenantId))
    .limit(1);

  const passwordHash = rows[0]?.passwordHash;
  if (!passwordHash) {
    return { success: false };
  }

  const valid = await verifyStorePassword(password, passwordHash);
  if (!valid) {
    return { success: false };
  }

  return {
    success: true,
    token: password,
  };
}
