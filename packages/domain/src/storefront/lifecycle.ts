import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "@bs/db";
import { schema, withTenant } from "@bs/db";
import { resolveHostToTenant } from "../host-resolver.ts";
import type { HeaderValues, TenantContext } from "../context.ts";
import { assertPermission } from "../context.ts";
import { FeatureDisabledError, isFeatureEnabled } from "../features.ts";
import type { Runtime } from "../runtime.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { storefrontLifecycleDecision } from "../system/tenant-lifecycle.ts";
import { recordHostMode } from "./lookup-fallback.ts";
import type { StoreStatusTransitionItem } from "@bs/contracts";

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
        maintenanceStartsAt?: Date | null;
        maintenanceEndsAt?: Date | null;
        modeBeforeMaintenance?: string | null;
        maintenanceAllowStaffPreview?: boolean | null;
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
          maintenanceStartsAt: schema.storeStatus.maintenanceStartsAt,
          maintenanceEndsAt: schema.storeStatus.maintenanceEndsAt,
          modeBeforeMaintenance: schema.storeStatus.modeBeforeMaintenance,
          maintenanceAllowStaffPreview: schema.storeStatus.maintenanceAllowStaffPreview,
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
  recordHostMode(rawHost, mode);

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

  const allowStaffPreview =
    mode === "maintenance" ? (statusRow?.maintenanceAllowStaffPreview ?? true) : true;
  const isBypass = (isStaff || isTokenBypass) && allowStaffPreview;

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
    let retryAfterSeconds: number;
    if (statusRow?.maintenanceEndsAt) {
      const remaining = Math.floor((statusRow.maintenanceEndsAt.getTime() - Date.now()) / 1000);
      retryAfterSeconds = Math.min(24 * 3600, Math.max(60, remaining));
    } else {
      const retryAfterMinutes = statusRow?.retryAfterMinutes ?? 60;
      retryAfterSeconds = retryAfterMinutes * 60;
    }
    return {
      allowed: false,
      reason: "maintenance",
      status: "maintenance",
      httpStatus: 503,
      mode: "maintenance",
      tenantId,
      tenantStatus,
      retryAfterSeconds,
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
  maintenanceStartsAt?: string | null;
  maintenanceEndsAt?: string | null;
  modeBeforeMaintenance?: string | null;
  maintenanceAllowStaffPreview?: boolean;
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
      maintenanceStartsAt: row?.maintenanceStartsAt ? row.maintenanceStartsAt.toISOString() : null,
      maintenanceEndsAt: row?.maintenanceEndsAt ? row.maintenanceEndsAt.toISOString() : null,
      modeBeforeMaintenance: row?.modeBeforeMaintenance ?? null,
      maintenanceAllowStaffPreview: row?.maintenanceAllowStaffPreview ?? true,
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
    const [existing] = await tx
      .select()
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, ctx.tenantId))
      .limit(1);

    // Maintenance mutations allowed only for Store Owner (decision 10)
    if (
      (input.mode === "maintenance" || existing?.mode === "maintenance") &&
      (!ctx.roles.includes("store_owner") || ctx.actor.type !== "staff")
    ) {
      throw new Error("Forbidden: only store owners can manage maintenance mode");
    }

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

    if (input.mode === "maintenance" && existing?.mode !== "maintenance") {
      updateValues.modeBeforeMaintenance = existing?.mode ?? "live";
      if (!existing?.maintenanceEndsAt) {
        // Auto-restore safeguard: default 24h
        updateValues.maintenanceEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }
    } else if (input.mode !== undefined && input.mode !== "maintenance" && existing?.mode === "maintenance") {
      updateValues.maintenanceStartsAt = null;
      updateValues.maintenanceEndsAt = null;
      updateValues.modeBeforeMaintenance = null;
    }

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
          modeBeforeMaintenance: (updateValues.modeBeforeMaintenance as string | null) ?? null,
          maintenanceEndsAt: (updateValues.maintenanceEndsAt as Date | null) ?? null,
        })
        .returning({ id: schema.storeStatus.id });
      statusId = inserted?.id ?? ctx.tenantId;
    }

    // Record transition if mode changed
    if (input.mode !== undefined && input.mode !== existing?.mode) {
      await tx.insert(schema.storeStatusTransitions).values({
        tenantId: ctx.tenantId,
        fromMode: existing?.mode ?? "coming_soon",
        toMode: input.mode,
        reason: "manual",
        actorType: ctx.actor.type,
        actorId: "userId" in ctx.actor ? ctx.actor.userId : null,
        at: new Date(),
      });
    }

    // Build sanitized audit diff (ADR-020, AGENTS.md rule 7)
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

/**
 * Schedules maintenance for a future window (at most 72 hours long, starts at least 2 minutes in future).
 * Owner-only mutation (decision 10).
 */
export async function scheduleMaintenance(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    startsAt: string;
    endsAt: string;
    allowStaffPreview?: boolean;
  },
): Promise<StoreStatusView> {
  assertPermission(ctx, "storefront.manage");
  if (!ctx.roles.includes("store_owner") || ctx.actor.type !== "staff") {
    throw new Error("Forbidden: only store owners can schedule maintenance");
  }
  if (!(await isFeatureEnabled(rt._db.db, ctx.tenantId, "settings.maintenance"))) {
    throw new FeatureDisabledError("settings.maintenance");
  }

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    throw new Error("Bad Request: invalid startsAt or endsAt date");
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error("Bad Request: maintenance end time must be after start time");
  }
  const maxWindowMs = 72 * 60 * 60 * 1000;
  if (endsAt.getTime() - startsAt.getTime() > maxWindowMs) {
    throw new Error("Bad Request: maintenance window cannot exceed 72 hours");
  }
  const minFutureMs = 2 * 60 * 1000 - 15000;
  if (startsAt.getTime() < Date.now() + minFutureMs) {
    throw new Error("Bad Request: scheduled maintenance start must be at least 2 minutes in the future");
  }

  const db = rt._db.db;
  await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, ctx.tenantId))
      .limit(1);

    const updateValues = {
      maintenanceStartsAt: startsAt,
      maintenanceEndsAt: endsAt,
      maintenanceAllowStaffPreview: input.allowStaffPreview ?? true,
      changedAt: new Date(),
      changedBy: "userId" in ctx.actor ? ctx.actor.userId : null,
    };

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
          mode: "coming_soon",
          ...updateValues,
        })
        .returning({ id: schema.storeStatus.id });
      statusId = inserted?.id ?? ctx.tenantId;
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: "userId" in ctx.actor ? ctx.actor.userId : null,
      action: "store_status.schedule_maintenance",
      targetType: "store_status",
      targetId: statusId,
      diff: {
        maintenanceStartsAt: { before: existing?.maintenanceStartsAt?.toISOString() ?? null, after: startsAt.toISOString() },
        maintenanceEndsAt: { before: existing?.maintenanceEndsAt?.toISOString() ?? null, after: endsAt.toISOString() },
        maintenanceAllowStaffPreview: { before: existing?.maintenanceAllowStaffPreview ?? true, after: input.allowStaffPreview ?? true },
      },
    });
  });

  if (rt._jobs) {
    try {
      await rt._jobs.send("maintenance.start", {
        tenantId: ctx.tenantId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
      await rt._jobs.send("maintenance.end", {
        tenantId: ctx.tenantId,
        endsAt: endsAt.toISOString(),
      });
    } catch {
      // Watchdog sweep ensures recovery
    }
  }

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return getStoreStatusInternal(rt, ctx.tenantId);
}

/**
 * Cancels scheduled maintenance. Owner-only mutation (decision 10).
 */
export async function cancelScheduledMaintenance(
  rt: Runtime,
  ctx: TenantContext,
): Promise<StoreStatusView> {
  assertPermission(ctx, "storefront.manage");
  if (!ctx.roles.includes("store_owner") || ctx.actor.type !== "staff") {
    throw new Error("Forbidden: only store owners can manage maintenance mode");
  }

  const db = rt._db.db;
  await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, ctx.tenantId))
      .limit(1);

    if (!existing || (!existing.maintenanceStartsAt && !existing.maintenanceEndsAt)) {
      return;
    }

    await tx
      .update(schema.storeStatus)
      .set({
        maintenanceStartsAt: null,
        maintenanceEndsAt: null,
        changedAt: new Date(),
        changedBy: "userId" in ctx.actor ? ctx.actor.userId : null,
      })
      .where(eq(schema.storeStatus.id, existing.id));

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: "userId" in ctx.actor ? ctx.actor.userId : null,
      action: "store_status.cancel_scheduled_maintenance",
      targetType: "store_status",
      targetId: existing.id,
      diff: {
        maintenanceStartsAt: { before: existing.maintenanceStartsAt?.toISOString() ?? null, after: null },
        maintenanceEndsAt: { before: existing.maintenanceEndsAt?.toISOString() ?? null, after: null },
      },
    });
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return getStoreStatusInternal(rt, ctx.tenantId);
}

/**
 * Ends ongoing maintenance, restoring mode_before_maintenance (or live).
 * Owner-only mutation (decision 10).
 */
export async function endMaintenance(
  rt: Runtime,
  ctx: TenantContext,
): Promise<StoreStatusView> {
  assertPermission(ctx, "storefront.manage");
  if (!ctx.roles.includes("store_owner") || ctx.actor.type !== "staff") {
    throw new Error("Forbidden: only store owners can manage maintenance mode");
  }

  const db = rt._db.db;
  await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, ctx.tenantId))
      .limit(1);

    if (!existing) return;

    const restoreMode: StorefrontMode = (existing.modeBeforeMaintenance as StorefrontMode) || "live";
    const previousMode = existing.mode as StorefrontMode;

    await tx
      .update(schema.storeStatus)
      .set({
        mode: restoreMode,
        maintenanceStartsAt: null,
        maintenanceEndsAt: null,
        modeBeforeMaintenance: null,
        changedAt: new Date(),
        changedBy: "userId" in ctx.actor ? ctx.actor.userId : null,
      })
      .where(eq(schema.storeStatus.id, existing.id));

    if (previousMode !== restoreMode) {
      await tx.insert(schema.storeStatusTransitions).values({
        tenantId: ctx.tenantId,
        fromMode: previousMode,
        toMode: restoreMode,
        reason: "manual",
        actorType: ctx.actor.type,
        actorId: "userId" in ctx.actor ? ctx.actor.userId : null,
        at: new Date(),
      });
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: "userId" in ctx.actor ? ctx.actor.userId : null,
      action: "store_status.end_maintenance",
      targetType: "store_status",
      targetId: existing.id,
      diff: {
        mode: { before: previousMode, after: restoreMode },
        maintenanceEndsAt: { before: existing.maintenanceEndsAt?.toISOString() ?? null, after: null },
      },
    });
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return getStoreStatusInternal(rt, ctx.tenantId);
}

/**
 * Paged list of store status transitions.
 */
export async function listStoreStatusTransitions(
  rt: Runtime,
  ctx: TenantContext,
  opts?: { limit?: number; offset?: number },
): Promise<{ items: StoreStatusTransitionItem[]; total: number }> {
  assertPermission(ctx, "storefront.manage");
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  const offset = Math.max(opts?.offset ?? 0, 0);

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.storeStatusTransitions)
      .where(eq(schema.storeStatusTransitions.tenantId, ctx.tenantId));

    const rows = await tx
      .select()
      .from(schema.storeStatusTransitions)
      .where(eq(schema.storeStatusTransitions.tenantId, ctx.tenantId))
      .orderBy(desc(schema.storeStatusTransitions.at))
      .limit(limit)
      .offset(offset);

    const items: StoreStatusTransitionItem[] = rows.map((r) => ({
      id: r.id,
      fromMode: r.fromMode,
      toMode: r.toMode,
      reason: r.reason as StoreStatusTransitionItem["reason"],
      actorType: r.actorType,
      actorId: r.actorId,
      at: r.at.toISOString(),
    }));

    return {
      items,
      total: totalRow?.count ?? 0,
    };
  });
}

/**
 * Watchdog sweep to ensure stores are never stranded in maintenance mode.
 * Restores expired windows and triggers due scheduled maintenance.
 */
export async function executeMaintenanceWatchdogSweep(
  db: Db,
): Promise<{ restoredCount: number; startedCount: number }> {
  const now = new Date();
  let restoredCount = 0;
  let startedCount = 0;

  // store_status is a tenant table under forced RLS, so a read without a tenant context sees zero rows (the worker
  // runs as app_rw). Visit each tenant under its own context, like the other sweeps; only rows that carry a
  // maintenance window are fetched, then classified here.
  const tenantIds = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  type StatusRow = typeof schema.storeStatus.$inferSelect;
  const expiredMaintenance: StatusRow[] = [];
  const dueScheduled: StatusRow[] = [];
  for (const t of tenantIds) {
    const [row] = await withTenant(db, t.id, (tx) =>
      tx
        .select()
        .from(schema.storeStatus)
        .where(
          and(
            eq(schema.storeStatus.tenantId, t.id),
            or(isNotNull(schema.storeStatus.maintenanceEndsAt), isNotNull(schema.storeStatus.maintenanceStartsAt)),
          ),
        )
        .limit(1),
    );
    if (!row) continue;
    const endsAt = row.maintenanceEndsAt;
    const startsAt = row.maintenanceStartsAt;
    if (row.mode === "maintenance") {
      // 1. Restore stores whose maintenance window has passed
      if (endsAt && endsAt <= now) expiredMaintenance.push(row);
    } else if (startsAt && startsAt <= now && (!endsAt || endsAt > now)) {
      // 2. Start scheduled maintenance that has arrived but not yet started
      dueScheduled.push(row);
    }
  }

  for (const row of expiredMaintenance) {
    if (!row.tenantId) continue;
    const restoreMode: StorefrontMode = (row.modeBeforeMaintenance as StorefrontMode) || "live";
    await withTenant(db, row.tenantId, async (tx) => {
      await tx
        .update(schema.storeStatus)
        .set({
          mode: restoreMode,
          maintenanceStartsAt: null,
          maintenanceEndsAt: null,
          modeBeforeMaintenance: null,
          changedAt: now,
          changedBy: null,
        })
        .where(eq(schema.storeStatus.id, row.id));

      await tx.insert(schema.storeStatusTransitions).values({
        tenantId: row.tenantId,
        fromMode: "maintenance",
        toMode: restoreMode,
        reason: "watchdog_restore",
        actorType: "system",
        actorId: null,
        at: now,
      });

      await tx.insert(schema.auditLogs).values({
        tenantId: row.tenantId,
        actorType: "system",
        actorId: null,
        action: "store_status.watchdog_restore",
        targetType: "store_status",
        targetId: row.id,
        diff: {
          mode: { before: "maintenance", after: restoreMode },
          reason: { before: null, after: "watchdog_restore" },
        },
      });
    });
    restoredCount++;
  }

  for (const row of dueScheduled) {
    if (!row.tenantId) continue;
    const currentMode = row.mode as StorefrontMode;
    await withTenant(db, row.tenantId, async (tx) => {
      await tx
        .update(schema.storeStatus)
        .set({
          mode: "maintenance",
          modeBeforeMaintenance: currentMode,
          changedAt: now,
          changedBy: null,
        })
        .where(eq(schema.storeStatus.id, row.id));

      await tx.insert(schema.storeStatusTransitions).values({
        tenantId: row.tenantId,
        fromMode: currentMode,
        toMode: "maintenance",
        reason: "scheduled_start",
        actorType: "system",
        actorId: null,
        at: now,
      });

      await tx.insert(schema.auditLogs).values({
        tenantId: row.tenantId,
        actorType: "system",
        actorId: null,
        action: "store_status.scheduled_start",
        targetType: "store_status",
        targetId: row.id,
        diff: {
          mode: { before: currentMode, after: "maintenance" },
          reason: { before: null, after: "scheduled_start" },
        },
      });
    });
    startedCount++;
  }

  return { restoredCount, startedCount };
}

