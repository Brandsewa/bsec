import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import type { Db } from "@bs/db";
import { schema, withTenant } from "@bs/db";
import { resolveHostToTenant } from "../host-resolver.ts";
import type { HeaderValues, TenantContext } from "../context.ts";
import { assertPermission } from "../context.ts";
import type { Runtime } from "../runtime.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { storefrontLifecycleDecision } from "../system/tenant-lifecycle.ts";

const scryptAsync = promisify(scrypt);
const SCRYPT_PREFIX = "$scrypt$";
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEYLEN = 64;

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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return a === b;
  }
}

/**
 * Indicates whether a stored password hash is using the legacy SHA-256 scheme and needs rehash.
 */
export function needsStorePasswordRehash(hash: string): boolean {
  if (!hash) return false;
  return !hash.startsWith(SCRYPT_PREFIX);
}

/**
 * Hashes a plaintext store password using salted scrypt.
 */
export async function hashStorePassword(plain: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES).toString("hex");
  const derived = (await scryptAsync(plain, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${SCRYPT_PREFIX}${salt}$${derived.toString("hex")}`;
}

/**
 * Verifies a plaintext store password against a stored scrypt hash ($scrypt$...)
 * or legacy 64-hex SHA-256 hash.
 * Does NOT permit plain === hash replay.
 */
export async function verifyStorePassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;

  // Modern salted scrypt format: $scrypt$<saltHex>$<derivedKeyHex>
  if (hash.startsWith(SCRYPT_PREFIX)) {
    const parts = hash.split("$");
    if (parts.length !== 4) return false;
    const [, , saltHex, keyHex] = parts;
    if (!saltHex || !keyHex) return false;
    try {
      const derived = (await scryptAsync(plain, saltHex, SCRYPT_KEYLEN)) as Buffer;
      const expected = Buffer.from(keyHex, "hex");
      if (derived.length !== expected.length) return false;
      return timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  // Legacy SHA-256 format (must be 64 hex characters)
  // plain === hash is intentionally NOT checked so stored hashes cannot be replayed as passwords.
  if (!/^[0-9a-f]{64}$/i.test(hash)) return false;
  const computed = createHash("sha256").update(plain).digest("hex");
  return safeEqual(computed, hash);
}

/**
 * Hashes a preview bypass token using SHA-256.
 */
export function hashBypassToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Verifies a preview bypass token against a stored token hash in constant time.
 * Does NOT permit token === hash replay.
 */
export function verifyBypassToken(token: string, hash: string): boolean {
  if (!token || !hash) return false;
  if (!/^[0-9a-f]{64}$/i.test(hash)) return false;
  const computed = hashBypassToken(token);
  return safeEqual(computed, hash);
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

  // 2. Tenant Lifecycle Check (PLAN §6.4): one shared decision, see system/tenant-lifecycle.ts
  const lifecycle = storefrontLifecycleDecision(tenantStatus);
  if (!lifecycle.served) {
    return {
      allowed: false,
      httpStatus: lifecycle.httpStatus,
      reason: lifecycle.reason,
      status: lifecycle.reason,
      tenantId,
      tenantStatus,
      ...(lifecycle.reason === "provisioning" ? { message: "Store is being provisioned" } : {}),
      ...(lifecycle.reason === "suspended" ? { message: "This store is temporarily unavailable" } : {}),
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
    const queryStatus = async (qdb: Db) => {
      return await qdb
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
    };

    const rows =
      typeof db.transaction === "function"
        ? await withTenant(db, tenantId, queryStatus)
        : await queryStatus(db);

    statusRow = rows[0];
  } catch {
    // Gracefully handle unconfigured or mocked db
  }

  const mode: StorefrontMode = (statusRow?.mode as StorefrontMode) ?? "coming_soon";

  // 4. SEO & Robots Policy (PLAN §8.3)
  let indexingEnabled = true;
  try {
    const querySeo = async (qdb: Db) => {
      return await qdb
        .select({
          indexingEnabled: schema.seoSettings.indexingEnabled,
        })
        .from(schema.seoSettings)
        .where(eq(schema.seoSettings.tenantId, tenantId))
        .limit(1);
    };

    const seoRows =
      typeof db.transaction === "function"
        ? await withTenant(db, tenantId, querySeo)
        : await querySeo(db);

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
      if (passwordHash && needsStorePasswordRehash(passwordHash)) {
        hashStorePassword(candidatePassword)
          .then((newHash) => {
            const updatePass = async (qdb: Db) => {
              await qdb
                .update(schema.storeStatus)
                .set({ passwordHash: newHash })
                .where(eq(schema.storeStatus.tenantId, tenantId));
            };
            if (typeof db.transaction === "function") {
              withTenant(db, tenantId, updatePass).catch(() => {});
            } else {
              updatePass(db).catch(() => {});
            }
          })
          .catch(() => {});
      }
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
  const queryPassword = async (qdb: Db) => {
    return await qdb
      .select({ passwordHash: schema.storeStatus.passwordHash })
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, ctx.tenantId))
      .limit(1);
  };

  const rows =
    typeof db.transaction === "function"
      ? await withTenant(db, ctx.tenantId, queryPassword)
      : await queryPassword(db);

  const passwordHash = rows[0]?.passwordHash;
  if (!passwordHash) {
    return { success: false };
  }

  const valid = await verifyStorePassword(password, passwordHash);
  if (!valid) {
    return { success: false };
  }

  if (needsStorePasswordRehash(passwordHash)) {
    const newHash = await hashStorePassword(password);
    const updatePass = async (qdb: Db) => {
      await qdb
        .update(schema.storeStatus)
        .set({ passwordHash: newHash })
        .where(eq(schema.storeStatus.tenantId, ctx.tenantId));
    };
    if (typeof db.transaction === "function") {
      await withTenant(db, ctx.tenantId, updatePass).catch(() => {});
    } else {
      await updatePass(db).catch(() => {});
    }
  }

  return {
    success: true,
    token: password,
  };
}

export interface StoreStatusView {
  mode: StorefrontMode;
  headline: string | null;
  showCountdown: boolean;
  collectEmails: boolean;
  launchAt: string | null;
  hasPassword: boolean;
}

/** The store's current storefront mode and public message without permission assertion. */
export async function getStoreStatusInternal(rt: Runtime, tenantId: string): Promise<StoreStatusView> {
  return withTenant(rt._db.db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, tenantId))
      .limit(1);
    return {
      mode: (row?.mode as StorefrontMode | undefined) ?? "coming_soon",
      headline: row?.headline ?? null,
      showCountdown: row?.showCountdown ?? false,
      collectEmails: row?.collectEmails ?? true,
      launchAt: row?.launchAt ? row.launchAt.toISOString() : null,
      hasPassword: Boolean(row?.passwordHash),
    };
  });
}

/** The store's current storefront mode and public message. A store that has no row yet is in "coming_soon" (the default). */
export async function getStoreStatus(rt: Runtime, ctx: TenantContext): Promise<StoreStatusView> {
  assertPermission(ctx, "settings.read");
  return getStoreStatusInternal(rt, ctx.tenantId);
}

/**
 * Updates store status (mode, message, countdown, password, bypass token) and invalidates cache.
 */
export async function updateStoreStatus(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    mode?: StorefrontMode | undefined;
    headline?: string | null | undefined;
    messageJson?: unknown;
    launchAt?: Date | null | undefined;
    showCountdown?: boolean | undefined;
    collectEmails?: boolean | undefined;
    password?: string | null | undefined;
    retryAfterMinutes?: number | null | undefined;
    bypassToken?: string | null | undefined;
  },
): Promise<{ success: boolean }> {
  assertPermission(ctx, "storefront.manage");
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    const updateValues: Record<string, unknown> = {
      changedAt: new Date(),
      changedBy: "userId" in ctx.actor ? ctx.actor.userId : null,
    };
    if (input.mode !== undefined) updateValues.mode = input.mode;
    if (input.headline !== undefined) updateValues.headline = input.headline;
    if (input.messageJson !== undefined) updateValues.messageJson = input.messageJson;
    if (input.launchAt !== undefined) updateValues.launchAt = input.launchAt;
    if (input.showCountdown !== undefined) updateValues.showCountdown = input.showCountdown;
    if (input.collectEmails !== undefined) updateValues.collectEmails = input.collectEmails;
    if (input.retryAfterMinutes !== undefined) updateValues.retryAfterMinutes = input.retryAfterMinutes;
    if (input.password !== undefined) {
      updateValues.passwordHash = input.password ? await hashStorePassword(input.password) : null;
    }
    if (input.bypassToken !== undefined) {
      updateValues.bypassTokenHash = input.bypassToken ? hashBypassToken(input.bypassToken) : null;
    }

    const [existing] = await tx
      .select()
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, ctx.tenantId))
      .limit(1);

    if (input.mode === "password") {
      const willHavePassword =
        input.password !== undefined ? Boolean(input.password) : Boolean(existing?.passwordHash);
      if (!willHavePassword) {
        throw new Error("Bad Request: set a password before switching the storefront to password mode");
      }
    }

    let statusId: string;

    if (existing) {
      statusId = existing.id;
      await tx
        .update(schema.storeStatus)
        .set(updateValues)
        .where(eq(schema.storeStatus.id, existing.id));
    } else {
      const [inserted] = await tx
        .insert(schema.storeStatus)
        .values({
          tenantId: ctx.tenantId,
          mode: input.mode ?? "coming_soon",
          changedBy: "userId" in ctx.actor ? ctx.actor.userId : null,
          headline: input.headline ?? null,
          messageJson: input.messageJson,
          launchAt: input.launchAt ?? null,
          showCountdown: input.showCountdown ?? false,
          collectEmails: input.collectEmails ?? true,
          retryAfterMinutes: input.retryAfterMinutes ?? 60,
          passwordHash: (updateValues.passwordHash as string | null) ?? null,
          bypassTokenHash: (updateValues.bypassTokenHash as string | null) ?? null,
        })
        .returning({ id: schema.storeStatus.id });
      statusId = inserted!.id;
    }

    // Build sanitized audit diff (ADR-020, AGENTS.md rule 7)
    // Log mode, headline, message, launch time, showCountdown, collectEmails;
    // for password and bypass token, log ONLY whether set or cleared, NEVER values or hashes.
    const before: Record<string, unknown> = {
      mode: existing?.mode ?? "coming_soon",
      headline: existing?.headline ?? null,
      message: existing?.messageJson ?? null,
      launchTime: existing?.launchAt ? existing.launchAt.toISOString() : null,
      showCountdown: existing?.showCountdown ?? false,
      collectEmails: existing?.collectEmails ?? true,
      password: existing?.passwordHash ? "set" : "not_set",
      bypassToken: existing?.bypassTokenHash ? "set" : "not_set",
    };

    const after: Record<string, unknown> = {
      mode: input.mode !== undefined ? input.mode : (existing?.mode ?? "coming_soon"),
      headline: input.headline !== undefined ? input.headline : (existing?.headline ?? null),
      message: input.messageJson !== undefined ? input.messageJson : (existing?.messageJson ?? null),
      launchTime:
        input.launchAt !== undefined
          ? (input.launchAt ? input.launchAt.toISOString() : null)
          : (existing?.launchAt ? existing.launchAt.toISOString() : null),
      showCountdown:
        input.showCountdown !== undefined ? input.showCountdown : (existing?.showCountdown ?? false),
      collectEmails:
        input.collectEmails !== undefined ? input.collectEmails : (existing?.collectEmails ?? true),
      password:
        input.password !== undefined
          ? (input.password ? "set" : "cleared")
          : (existing?.passwordHash ? "set" : "not_set"),
      bypassToken:
        input.bypassToken !== undefined
          ? (input.bypassToken ? "set" : "cleared")
          : (existing?.bypassTokenHash ? "set" : "not_set"),
    };

    const diff: Record<string, { before: unknown; after: unknown }> = {};
    for (const [key, beforeVal] of Object.entries(before)) {
      const afterVal = after[key];
      if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
        diff[key] = { before: beforeVal, after: afterVal };
      }
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: "userId" in ctx.actor ? ctx.actor.userId : null,
      action: "store_status.update",
      targetType: "store_status",
      targetId: statusId,
      diff,
    });
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return { success: true };
}

