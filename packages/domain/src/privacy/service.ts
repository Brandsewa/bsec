import { createHash, randomBytes } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { deleteAdminCustomer } from "../admin/customers.ts";
import { setMarketingConsent } from "../customers/consent.ts";
import { sendTransactionalEmail } from "../system/email.ts";
import { checkRateLimit, RateLimitExceededError } from "../system/rate-limit.ts";

export interface PrivacySettingsView {
  privacyContactEmail: string | null;
  grievanceOfficerName: string | null;
  requestSlaDays: number;
  version: number;
}

export interface UpdatePrivacySettingsInput {
  privacyContactEmail?: string | null | undefined;
  grievanceOfficerName?: string | null | undefined;
  requestSlaDays?: number | undefined;
  expectedVersion?: number | undefined;
}

export type PrivacyRequestKind = "access" | "correction" | "erasure" | "grievance" | "withdraw_consent";
export type PrivacyRequestStatus = "pending_verification" | "open" | "in_progress" | "completed" | "rejected";

export interface PrivacyRequestItem {
  id: string;
  requesterEmail: string;
  kind: PrivacyRequestKind;
  details: string | null;
  status: PrivacyRequestStatus;
  verifiedAt: string | null;
  dueAt: string;
  handledBy: string | null;
  handledAt: string | null;
  resolutionNote: string | null;
  customerId: string | null;
  createdAt: string;
}

export interface CookieInventoryItem {
  name: string;
  purpose: string;
  duration: string;
  category: "strictly_necessary";
}

/**
 * Test-locked static cookie inventory (Slice 7C, PLAN §5).
 * The storefront sets ONLY strictly necessary cookies.
 * No analytics, advertising, or marketing cookies exist.
 */
export const TEST_LOCKED_COOKIE_INVENTORY: CookieInventoryItem[] = [
  {
    name: "bs_cart_token",
    purpose: "Maintains customer shopping bag items across requests and page reloads.",
    duration: "30 days",
    category: "strictly_necessary",
  },
  {
    name: "bs_customer_session",
    purpose: "Cryptographic session credential maintaining customer authentication.",
    duration: "Session / 14 days",
    category: "strictly_necessary",
  },
  {
    name: "bs_store_password_gate",
    purpose: "Stores access bypass token when storefront is in password-protected or coming-soon mode.",
    duration: "24 hours",
    category: "strictly_necessary",
  },
];

/** Static cookie inventory shown to merchants; permission-checked here so the route is not the only gate. */
export function getCookieInventory(ctx: TenantContext): CookieInventoryItem[] {
  assertPermission(ctx, "settings.read");
  return TEST_LOCKED_COOKIE_INVENTORY;
}

/**
 * Ensures a single privacy_settings row exists per tenant.
 */
async function ensurePrivacySettingsRow(tx: Db, tenantId: string) {
  const [row] = await tx
    .select()
    .from(schema.privacySettings)
    .where(eq(schema.privacySettings.tenantId, tenantId))
    .limit(1);

  if (!row) {
    const [inserted] = await tx
      .insert(schema.privacySettings)
      .values({
        tenantId,
        privacyContactEmail: null,
        grievanceOfficerName: null,
        requestSlaDays: 30,
        version: 1,
      })
      .returning();
    if (inserted) return inserted;
    throw new Error("Failed to initialize privacy settings");
  }

  return row;
}

/**
 * Read privacy settings. Requires settings.read or privacy.manage.
 */
export async function getPrivacySettings(
  rt: Runtime,
  ctx: TenantContext,
): Promise<PrivacySettingsView> {
  assertPermission(ctx, "settings.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const row = await ensurePrivacySettingsRow(tx, ctx.tenantId);
    return {
      privacyContactEmail: row.privacyContactEmail,
      grievanceOfficerName: row.grievanceOfficerName,
      requestSlaDays: row.requestSlaDays,
      version: row.version,
    };
  });
}

/**
 * Update privacy settings. Requires privacy.manage. Stale-write guarded.
 */
export async function updatePrivacySettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdatePrivacySettingsInput,
): Promise<PrivacySettingsView> {
  assertPermission(ctx, "privacy.manage");
  const db = rt._db.db;

  const result = await withTenant(db, ctx.tenantId, async (tx) => {
    const current = await ensurePrivacySettingsRow(tx, ctx.tenantId);

    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new Error(`Conflict: Privacy settings were updated by another session (version mismatch)`);
    }

    const nextSlaDays = input.requestSlaDays !== undefined ? input.requestSlaDays : current.requestSlaDays;
    if (nextSlaDays < 7 || nextSlaDays > 90) {
      throw new Error("Request SLA days must be between 7 and 90");
    }

    const privacyContactEmail =
      input.privacyContactEmail !== undefined ? (input.privacyContactEmail ? input.privacyContactEmail.trim().toLowerCase() : null) : current.privacyContactEmail;
    const grievanceOfficerName =
      input.grievanceOfficerName !== undefined ? (input.grievanceOfficerName ? input.grievanceOfficerName.trim() : null) : current.grievanceOfficerName;

    const nextVersion = current.version + 1;
    const now = new Date();

    await tx
      .update(schema.privacySettings)
      .set({
        privacyContactEmail,
        grievanceOfficerName,
        requestSlaDays: nextSlaDays,
        version: nextVersion,
        updatedAt: now,
      })
      .where(and(eq(schema.privacySettings.tenantId, ctx.tenantId), eq(schema.privacySettings.id, current.id)));

    if (ctx.actor?.type === "staff") {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.userId,
        action: "settings.privacy_updated",
        targetType: "privacy_settings",
        targetId: current.id,
        diff: {
          before: current,
          after: { privacyContactEmail, grievanceOfficerName, requestSlaDays: nextSlaDays, version: nextVersion },
        },
      });
    }

    return {
      privacyContactEmail,
      grievanceOfficerName,
      requestSlaDays: nextSlaDays,
      version: nextVersion,
    };
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return result;
}

/**
 * Public storefront intake: submit a data principal privacy request.
 * Anti-enumerating: always succeeds, creates request in pending_verification,
 * and sends an email verification link using an action_token.
 */
export async function createPrivacyRequestPublic(
  db: Db,
  tenantId: string,
  input: {
    email: string;
    kind: PrivacyRequestKind;
    details?: string | undefined;
    baseUrl?: string | undefined;
    ip?: string | undefined;
  },
): Promise<{ success: true; message: string }> {
  const email = input.email.trim().toLowerCase();

  // Each request mails a verification link to an address the visitor typed, so cap it per address and per IP
  // (the route's tenant-wide limiter alone lets one visitor aim every request at a single victim).
  const emailKey = `privacy_req:email:${tenantId}:${email}`;
  const emailRes = await checkRateLimit(db, { key: emailKey, limit: 3, windowSeconds: 3600 });
  if (!emailRes.allowed) {
    throw new RateLimitExceededError("Too many privacy requests for this email. Please try again later.", emailRes.retryAfter, 3, emailKey);
  }
  if (input.ip && input.ip !== "unknown") {
    const ipKey = `privacy_req:ip:${tenantId}:${input.ip}`;
    const ipRes = await checkRateLimit(db, { key: ipKey, limit: 10, windowSeconds: 3600 });
    if (!ipRes.allowed) {
      throw new RateLimitExceededError("Too many privacy requests from this network. Please try again later.", ipRes.retryAfter, 10, ipKey);
    }
  }
  const kind = input.kind;
  const details = input.details?.trim().slice(0, 2000) || null;

  return await withTenant(db, tenantId, async (tx) => {
    // 1. Look up if a registered customer exists
    const [customer] = await tx
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, email)))
      .limit(1);

    // 2. Fetch SLA days
    const pSettings = await ensurePrivacySettingsRow(tx, tenantId);
    const dueAt = new Date(Date.now() + pSettings.requestSlaDays * 86_400_000);

    // 3. Create request row
    const [reqRow] = await tx
      .insert(schema.privacyRequests)
      .values({
        tenantId,
        customerId: customer?.id ?? null,
        requesterEmail: email,
        kind,
        details,
        status: "pending_verification",
        dueAt,
      })
      .returning({ id: schema.privacyRequests.id });

    if (!reqRow) {
      throw new Error("Failed to create privacy request record");
    }

    // 4. Create single-use action token (expires in 24 hours)
    const rawToken = randomBytes(24).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

    await tx.insert(schema.actionTokens).values({
      tenantId,
      purpose: "privacy_request_verify",
      targetId: reqRow.id,
      tokenHash,
      expiresAt,
    });

    // 5. Send verification email via transactional email dispatcher
    const verifyUrl = `${input.baseUrl ?? ""}/privacy-verify?token=${rawToken}`;
    await sendTransactionalEmail(db, {
      tenantId,
      template: "customer_account_setup", // clean layout with button link
      toEmail: email,
      subject: "Verify your privacy request",
      data: {
        setupUrl: verifyUrl,
      },
      eventRef: `privacy_verify_${reqRow.id}`,
    }).catch(() => {
      // Do not fail public intake if mailer is unconfigured
    });

    return {
      success: true,
      message: "If that email is recognized, a verification link has been sent. Please check your inbox.",
    };
  });
}

/**
 * Verifies a privacy request using the single-use action token.
 */
export async function verifyPrivacyRequest(
  db: Db,
  tenantId: string,
  rawToken: string,
): Promise<{ success: boolean; requestId?: string; message: string }> {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  return await withTenant(db, tenantId, async (tx) => {
    const [tokenRow] = await tx
      .select()
      .from(schema.actionTokens)
      .where(
        and(
          eq(schema.actionTokens.tenantId, tenantId),
          eq(schema.actionTokens.purpose, "privacy_request_verify"),
          eq(schema.actionTokens.tokenHash, tokenHash),
        ),
      )
      .limit(1);

    if (!tokenRow) {
      return { success: false, message: "Invalid or expired verification token." };
    }

    if (tokenRow.usedAt !== null || tokenRow.expiresAt < new Date()) {
      return { success: false, message: "Verification link has expired or has already been used." };
    }

    const now = new Date();

    // Mark token used
    await tx
      .update(schema.actionTokens)
      .set({ usedAt: now })
      .where(eq(schema.actionTokens.id, tokenRow.id));

    // Update privacy request status to 'open'
    await tx
      .update(schema.privacyRequests)
      .set({
        status: "open",
        verifiedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.privacyRequests.tenantId, tenantId),
          eq(schema.privacyRequests.id, tokenRow.targetId),
        ),
      );

    return {
      success: true,
      requestId: tokenRow.targetId,
      message: "Your privacy request has been verified and submitted for processing.",
    };
  });
}

/**
 * List privacy requests for store admin queue.
 * Requires privacy.manage.
 */
export async function listPrivacyRequests(
  rt: Runtime,
  ctx: TenantContext,
  filter?: { status?: PrivacyRequestStatus | undefined },
): Promise<{ items: PrivacyRequestItem[]; overdueCount: number }> {
  assertPermission(ctx, "privacy.manage");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [eq(schema.privacyRequests.tenantId, ctx.tenantId)];
    if (filter?.status) {
      conditions.push(eq(schema.privacyRequests.status, filter.status));
    }

    const rows = await tx
      .select()
      .from(schema.privacyRequests)
      .where(and(...conditions))
      .orderBy(desc(schema.privacyRequests.createdAt));

    const now = new Date();
    let overdueCount = 0;

    const items: PrivacyRequestItem[] = rows.map((r) => {
      const isOverdue = r.status !== "completed" && r.status !== "rejected" && r.dueAt < now;
      if (isOverdue) overdueCount++;

      return {
        id: r.id,
        requesterEmail: r.requesterEmail,
        kind: r.kind as PrivacyRequestKind,
        details: r.details,
        status: r.status as PrivacyRequestStatus,
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
        dueAt: r.dueAt.toISOString(),
        handledBy: r.handledBy,
        handledAt: r.handledAt ? r.handledAt.toISOString() : null,
        resolutionNote: r.resolutionNote,
        customerId: r.customerId,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return { items, overdueCount };
  });
}

/**
 * Transition status or update note of a privacy request.
 */
export async function updatePrivacyRequestStatus(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    id: string;
    status: PrivacyRequestStatus;
    resolutionNote?: string | undefined;
  },
): Promise<PrivacyRequestItem> {
  assertPermission(ctx, "privacy.manage");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.privacyRequests)
      .where(
        and(
          eq(schema.privacyRequests.tenantId, ctx.tenantId),
          eq(schema.privacyRequests.id, input.id),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error(`Privacy request not found: ${input.id}`);
    }

    const now = new Date();
    const resolutionNote = input.resolutionNote !== undefined ? input.resolutionNote.trim().slice(0, 1000) : existing.resolutionNote;
    const handledBy = ctx.actor?.type === "staff" ? ctx.actor.userId : null;
    const handledAt = input.status === "completed" || input.status === "rejected" ? now : existing.handledAt;

    await tx
      .update(schema.privacyRequests)
      .set({
        status: input.status,
        resolutionNote,
        handledBy,
        handledAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.privacyRequests.tenantId, ctx.tenantId),
          eq(schema.privacyRequests.id, input.id),
        ),
      );

    if (ctx.actor?.type === "staff") {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.userId,
        action: "privacy_request.status_updated",
        targetType: "privacy_request",
        targetId: input.id,
        diff: {
          previousStatus: existing.status,
          nextStatus: input.status,
          resolutionNote,
        },
      });
    }

    return {
      id: existing.id,
      requesterEmail: existing.requesterEmail,
      kind: existing.kind as PrivacyRequestKind,
      details: existing.details,
      status: input.status,
      verifiedAt: existing.verifiedAt ? existing.verifiedAt.toISOString() : null,
      dueAt: existing.dueAt.toISOString(),
      handledBy,
      handledAt: handledAt ? handledAt.toISOString() : null,
      resolutionNote,
      customerId: existing.customerId,
      createdAt: existing.createdAt.toISOString(),
    };
  });
}

/**
 * Action: Generate export JSON bundle for verified customer.
 * Strict isolation: excludes internal staff notes and other customers' data!
 */
export async function executePrivacyExport(
  rt: Runtime,
  ctx: TenantContext,
  requestId: string,
): Promise<{ success: boolean; exportBundle: Record<string, unknown> }> {
  assertPermission(ctx, "privacy.manage");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [req] = await tx
      .select()
      .from(schema.privacyRequests)
      .where(
        and(
          eq(schema.privacyRequests.tenantId, ctx.tenantId),
          eq(schema.privacyRequests.id, requestId),
        ),
      )
      .limit(1);

    if (!req) throw new Error(`Privacy request not found: ${requestId}`);

    let customerData: Record<string, unknown> | null = null;
    let addressesData: unknown[] = [];
    let ordersSummary: unknown[] = [];
    let consentHistory: unknown[] = [];
    const reviewsData: unknown[] = [];

    if (req.customerId) {
      const [c] = await tx
        .select({
          id: schema.customers.id,
          name: schema.customers.name,
          email: schema.customers.email,
          phone: schema.customers.phone,
          createdAt: schema.customers.createdAt,
        })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, req.customerId)))
        .limit(1);

      if (c) customerData = c as unknown as Record<string, unknown>;

      addressesData = await tx
        .select({
          name: schema.customerAddresses.name,
          line1: schema.customerAddresses.line1,
          line2: schema.customerAddresses.line2,
          city: schema.customerAddresses.city,
          stateCode: schema.customerAddresses.stateCode,
          pincode: schema.customerAddresses.pincode,
          country: schema.customerAddresses.country,
        })
        .from(schema.customerAddresses)
        .where(and(eq(schema.customerAddresses.tenantId, ctx.tenantId), eq(schema.customerAddresses.customerId, req.customerId)));

      ordersSummary = await tx
        .select({
          number: schema.orders.number,
          placedAt: schema.orders.placedAt,
          grandTotal: schema.orders.grandTotal,
          status: schema.orders.status,
          paymentStatus: schema.orders.paymentStatus,
        })
        .from(schema.orders)
        .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.customerId, req.customerId)));

      consentHistory = await tx
        .select({
          channel: schema.customerConsentEvents.channel,
          state: schema.customerConsentEvents.state,
          source: schema.customerConsentEvents.source,
          at: schema.customerConsentEvents.at,
        })
        .from(schema.customerConsentEvents)
        .where(and(eq(schema.customerConsentEvents.tenantId, ctx.tenantId), eq(schema.customerConsentEvents.customerId, req.customerId)));
    }

    const exportBundle = {
      exportGeneratedAt: new Date().toISOString(),
      requesterEmail: req.requesterEmail,
      customerProfile: customerData,
      addresses: addressesData,
      orders: ordersSummary,
      consentEvents: consentHistory,
      reviews: reviewsData,
    };

    // Audit log
    if (ctx.actor?.type === "staff") {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: "staff",
        actorId: ctx.actor.userId,
        action: "privacy_request.export_executed",
        targetType: "privacy_request",
        targetId: requestId,
        diff: { customerId: req.customerId, requesterEmail: req.requesterEmail },
      });
    }

    return { success: true, exportBundle };
  });
}

/**
 * Action: Execute erasure for verified customer request.
 * Reuses deleteAdminCustomer (anonymises when orders exist, hard deletes otherwise).
 */
export async function executePrivacyErasure(
  rt: Runtime,
  ctx: TenantContext,
  requestId: string,
): Promise<{ success: boolean; mode: "deleted" | "anonymised" | "no_customer" }> {
  assertPermission(ctx, "privacy.manage");
  const db = rt._db.db;

  const [req] = await withTenant(db, ctx.tenantId, async (tx) => {
    return await tx
      .select()
      .from(schema.privacyRequests)
      .where(
        and(
          eq(schema.privacyRequests.tenantId, ctx.tenantId),
          eq(schema.privacyRequests.id, requestId),
        ),
      )
      .limit(1);
  });

  if (!req) throw new Error(`Privacy request not found: ${requestId}`);

  if (!req.customerId) {
    return { success: true, mode: "no_customer" };
  }

  // To prevent PostgreSQL composite FK ON DELETE SET NULL from attempting to nullify the non-null tenant_id,
  // we disassociate the customerId on the request row prior to customer deletion.
  await withTenant(db, ctx.tenantId, async (tx) => {
    await tx
      .update(schema.privacyRequests)
      .set({ customerId: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.privacyRequests.tenantId, ctx.tenantId),
          eq(schema.privacyRequests.id, requestId),
        ),
      );
  });

  // Delete customer with standard anonymise/hard-delete rule
  const res = await deleteAdminCustomer(rt, ctx, { id: req.customerId });

  // Update privacy request status to completed
  await withTenant(db, ctx.tenantId, async (tx) => {
    await tx
      .update(schema.privacyRequests)
      .set({
        status: "completed",
        resolutionNote: `Erasure completed (${res.mode}). Tax/order records retained as required by law.`,
        handledBy: ctx.actor?.type === "staff" ? ctx.actor.userId : null,
        handledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.privacyRequests.tenantId, ctx.tenantId),
          eq(schema.privacyRequests.id, requestId),
        ),
      );
  });

  return { success: true, mode: res.mode };
}

/**
 * Action: Withdraw marketing consent for requester.
 */
export async function executePrivacyWithdrawConsent(
  rt: Runtime,
  ctx: TenantContext,
  requestId: string,
): Promise<{ success: boolean }> {
  assertPermission(ctx, "privacy.manage");
  const db = rt._db.db;

  const [req] = await withTenant(db, ctx.tenantId, async (tx) => {
    return await tx
      .select()
      .from(schema.privacyRequests)
      .where(
        and(
          eq(schema.privacyRequests.tenantId, ctx.tenantId),
          eq(schema.privacyRequests.id, requestId),
        ),
      )
      .limit(1);
  });

  if (!req) throw new Error(`Privacy request not found: ${requestId}`);

  if (req.customerId) {
    await setMarketingConsent(rt, ctx, {
      customerId: req.customerId,
      state: "unsubscribed",
      source: "storefront_form",
      actorType: "customer",
    });
  }

  await withTenant(db, ctx.tenantId, async (tx) => {
    await tx
      .update(schema.privacyRequests)
      .set({
        status: "completed",
        resolutionNote: "Marketing consent successfully withdrawn.",
        handledBy: ctx.actor?.type === "staff" ? ctx.actor.userId : null,
        handledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.privacyRequests.tenantId, ctx.tenantId),
          eq(schema.privacyRequests.id, requestId),
        ),
      );
  });

  return { success: true };
}
