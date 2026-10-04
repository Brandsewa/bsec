import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { actionTokens, customers, withTenant, type Db } from "@bs/db";
import { hashPassword, verifyPassword } from "@bs/auth";
import {
  createCustomerSession,
  destroyAllCustomerSessions,
  destroyOtherCustomerSessions,
} from "./session.ts";
import type { Runtime } from "../runtime.ts";
import type { CustomerRecord } from "./otp.ts";
import { loadEmailBrand } from "../system/email-context.ts";
import { renderEmail } from "../system/email-templates.ts";
import { sendPlatformEmail } from "../system/platform-mailer.ts";
import {
  checkCustomerLoginRateLimit,
  checkCustomerPasswordResetRateLimit,
  checkCustomerRegisterRateLimit,
} from "../system/rate-limit.ts";
import { createLogger } from "../logger.ts";
import { readCustomerAccountSettingsInternal } from "../admin/customer-account-settings.ts";

const logger = createLogger("customer-auth");

export interface RegisterCustomerInput {
  name?: string | undefined;
  email: string;
  phone?: string | undefined;
  password?: string | undefined;
  acceptsMarketing?: boolean | undefined;
}

export interface CustomerAuthResult {
  customer: CustomerRecord;
  token: string;
}

// Fixed dummy argon2 hash for constant-time dummy verification on non-existent or passwordless accounts
const DUMMY_PASSWORD_HASH =
  "effe979df6698effc2817aae5fa649e7:56efb2e65eeb262d220227dd1c4081596c6f089f7e31447f1c90a308d3f84bd0c13f1fae6c3778507858c52f5b87cc04eda02db0f5341217a6019200becf082f";

const COMMON_PASSWORDS = new Set([
  "password",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty1234",
  "admin12345",
  "letmein123",
  "welcome123",
]);

function hashToken(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

function cleanPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.trim().replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function validateCustomerPassword(password: string): void {
  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters long");
  }
  if (password.length > 128) {
    throw new Error("Password must not exceed 128 characters");
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new Error("This password is too common. Please choose a stronger password");
  }
}

/**
 * Register a customer with name + email (PLAN §5.2 + review security fix).
 * Registration must NOT set a password or create a session.
 * Collects name+email only, creates/keeps the customer row WITHOUT touching an existing row's name/phone/password.
 * Sends an account setup link (action_tokens purpose 'password_reset') letting the customer set their password and mark emailVerified=true.
 * Responds generically whether an account exists or not to prevent account enumeration.
 */
export async function registerCustomer(
  db: Db,
  tenantId: string,
  input: RegisterCustomerInput,
  meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
): Promise<{ success: boolean; customer?: CustomerRecord | undefined; token?: string | undefined }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email address");
  }

  const phone = cleanPhone(input.phone);
  const ip = meta.ip ?? "127.0.0.1";

  // Rate limit registration per IP
  await checkCustomerRegisterRateLimit(db, { tenantId, ip });

  const acctSettings = await readCustomerAccountSettingsInternal(db, tenantId);
  if (!acctSettings.emailPasswordEnabled) {
    throw new Error("Email and password registration is disabled for this store");
  }

  const outcome = await withTenant(db, tenantId, async (tx) => {
    // Check if customer row exists for email
    const [existing] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.email, email)));

    let customerId: string;

    if (existing) {
      if (existing.passwordHash) {
        // Customer already has a registered password account.
        // To prevent enumeration and pre-registration takeover:
        // Do NOT touch existing row's name, phone, or passwordHash.
        // Send a generic notification or return generic success.
        return { alreadyRegistered: true, customerId: existing.id, email: existing.email };
      }
      // Existing guest/phone row with no password yet.
      // Do NOT touch existing name, phone, or any details to prevent tampering.
      // Mint setup link targeting existing row.
      customerId = existing.id;
    } else {
      // Create new customer with unverified email and null passwordHash
      const [created] = await tx
        .insert(customers)
        .values({
          tenantId,
          email,
          phone,
          name: input.name?.trim() || "",
          passwordHash: null,
          emailVerified: false,
          phoneVerified: false,
        })
        .returning();
      if (!created) throw new Error("Failed to create customer record");
      customerId = created.id;
      // Consent has one writer (PLAN 0c): it keeps accepts_marketing, the state and the history in step.
      if (input.acceptsMarketing) {
        const { setMarketingConsent } = await import("./consent.ts");
        await setMarketingConsent(
          { _db: { db: tx } } as unknown as Runtime,
          { tenantId, actor: { type: "customer", userId: created.id } },
          { customerId: created.id, state: "subscribed", source: "account_page", channel: "email", ip },
          tx,
        );
      }
    }

    // Mint account setup token (24 hours expiry, purpose: 'password_reset' so resetCustomerPassword accepts it)
    const rawSetupToken = `cst_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashToken(rawSetupToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await tx.insert(actionTokens).values({
      tenantId,
      purpose: "password_reset",
      targetId: customerId,
      tokenHash,
      expiresAt,
    });

    return {
      alreadyRegistered: false,
      customerId,
      email,
      setupToken: rawSetupToken,
    };
  });

  if (outcome.alreadyRegistered) {
    // Existing customer with password: send reminder or generic success without token/session
    return { success: true };
  }

  // Send account setup email via platform mailer
  if (outcome.setupToken) {
    try {
      const brand = await loadEmailBrand(db, tenantId);
      const setupUrl = `${brand.baseUrl}/account/reset-password/${outcome.setupToken}`;
      const { html, text } = renderEmail(
        "customer_account_setup",
        brand,
        { setupUrl, resetUrl: setupUrl },
        `Set up your account for ${brand.storeName}`,
      );

      queueMicrotask(async () => {
        try {
          await sendPlatformEmail(db, {
            tenantId,
            to: email,
            subject: `Set up your account for ${brand.storeName}`,
            html,
            text,
            fromName: brand.storeName,
            replyTo: brand.supportEmail ?? undefined,
            template: "customer_account_setup",
          });
        } catch (err) {
          logger.error({ err, email, tenantId }, "Failed to send customer setup email");
        }
      });
    } catch (err) {
      logger.error({ err, email, tenantId }, "Failed to prepare setup email");
    }
  }

  return {
    success: true,
  };
}

/**
 * Verify customer email using action_tokens (PLAN §5.2).
 * Single use, verifies email atomically via guarded UPDATE ... RETURNING, unlocks historical guest orders with this email.
 */
export async function verifyCustomerEmail(
  db: Db,
  tenantId: string,
  rawToken: string,
): Promise<{ success: boolean; customerId: string }> {
  const tokenHash = hashToken(rawToken);

  return await withTenant(db, tenantId, async (tx) => {
    // Single guarded UPDATE ... RETURNING to ensure atomic consumption and concurrency safety
    const [consumed] = await tx
      .update(actionTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(actionTokens.tenantId, tenantId),
          eq(actionTokens.purpose, "email_verification"),
          eq(actionTokens.tokenHash, tokenHash),
          isNull(actionTokens.usedAt),
          gt(actionTokens.expiresAt, new Date()),
        ),
      )
      .returning({ id: actionTokens.id, targetId: actionTokens.targetId });

    if (!consumed) {
      throw new Error("Invalid or expired verification link");
    }

    // Mark customer email verified and clear isGuest
    await tx
      .update(customers)
      .set({ emailVerified: true, isGuest: false, updatedAt: new Date() })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, consumed.targetId)));

    return { success: true, customerId: consumed.targetId };
  });
}

/**
 * Customer email + password sign in (PLAN §5.2).
 * Generic "Invalid email or password" error on failures to prevent enumeration.
 * Mitigates timing oracle by verifying against a fixed dummy argon2 hash when account/password does not exist.
 * Rate limited per (tenant, IP) and per (tenant, email).
 */
export async function loginCustomer(
  db: Db,
  tenantId: string,
  credentials: { email: string; password: string },
  meta: { ip?: string | undefined; userAgent?: string | undefined; skipRateLimit?: boolean | undefined } = {},
): Promise<CustomerAuthResult> {
  const email = credentials.email.trim().toLowerCase();
  const ip = meta.ip ?? "127.0.0.1";

  if (!meta.skipRateLimit) {
    await checkCustomerLoginRateLimit(db, { tenantId, ip, email });
  }

  const acctSettings = await readCustomerAccountSettingsInternal(db, tenantId);
  if (!acctSettings.emailPasswordEnabled) {
    throw new Error("Email and password sign-in is disabled for this store");
  }

  const result = await withTenant(db, tenantId, async (tx): Promise<CustomerAuthResult | null> => {
    const [cust] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.email, email), eq(customers.status, "active")));

    if (!cust || !cust.passwordHash) {
      // Defend against timing attacks: always run verifyPassword against dummy hash
      await verifyPassword({
        hash: DUMMY_PASSWORD_HASH,
        password: credentials.password,
      });
      return null;
    }

    const passwordOk = await verifyPassword({
      hash: cust.passwordHash,
      password: credentials.password,
    });

    if (!passwordOk) {
      return null;
    }

    const { token } = await createCustomerSession(tx, tenantId, cust.id, meta);

    const customerRecord: CustomerRecord = {
      id: cust.id,
      phone: cust.phone,
      email: cust.email,
      name: cust.name,
      phoneVerified: cust.phoneVerified,
      emailVerified: cust.emailVerified,
    };

    return { customer: customerRecord, token };
  });

  if (!result) {
    throw new Error("Invalid email or password");
  }

  return result;
}

/**
 * Request customer password reset (PLAN §5.2).
 * Generic response whether email exists or not.
 * If customer exists with password or guest account, mints 1-hour action_tokens row and sends email.
 */
export async function requestCustomerPasswordReset(
  db: Db,
  tenantId: string,
  emailInput: string,
  meta: { ip?: string | undefined } = {},
): Promise<{ success: boolean; message: string }> {
  const email = emailInput.trim().toLowerCase();
  const ip = meta.ip ?? "127.0.0.1";

  await checkCustomerPasswordResetRateLimit(db, { tenantId, ip, email });

  const outcome = await withTenant(db, tenantId, async (tx) => {
    const [cust] = await tx
      .select({ id: customers.id, email: customers.email, name: customers.name })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.email, email), eq(customers.status, "active")));

    if (!cust) return null;

    const rawResetToken = `cr_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashToken(rawResetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await tx.insert(actionTokens).values({
      tenantId,
      purpose: "password_reset",
      targetId: cust.id,
      tokenHash,
      expiresAt,
    });

    return {
      customerId: cust.id,
      email: cust.email,
      resetToken: rawResetToken,
    };
  });

  if (outcome?.resetToken) {
    try {
      const brand = await loadEmailBrand(db, tenantId);
      const resetUrl = `${brand.baseUrl}/account/reset-password/${outcome.resetToken}`;
      const { html, text } = renderEmail(
        "customer_password_reset",
        brand,
        { resetUrl },
        `Reset your password for ${brand.storeName}`,
      );

      queueMicrotask(async () => {
        try {
          await sendPlatformEmail(db, {
            tenantId,
            to: outcome.email,
            subject: `Reset your password for ${brand.storeName}`,
            html,
            text,
            fromName: brand.storeName,
            replyTo: brand.supportEmail ?? undefined,
            template: "customer_password_reset",
          });
        } catch (err) {
          logger.error({ err, email, tenantId }, "Failed to send customer password reset email");
        }
      });
    } catch (err) {
      logger.error({ err, email, tenantId }, "Failed to prepare customer password reset email");
    }
  }

  return {
    success: true,
    message: "If an account with this email exists, a password reset link has been sent.",
  };
}

/**
 * Reset customer password using action_token (PLAN §5.2).
 * Single use, atomic update, invalidates all existing sessions for the customer, sends password_changed mail.
 */
export async function resetCustomerPassword(
  db: Db,
  tenantId: string,
  params: { token: string; password: string },
): Promise<{ success: boolean }> {
  validateCustomerPassword(params.password);
  const tokenHash = hashToken(params.token);
  const newHash = await hashPassword(params.password);

  const customerId = await withTenant(db, tenantId, async (tx) => {
    // Single guarded UPDATE ... RETURNING to ensure atomic consumption and concurrency safety
    const [consumed] = await tx
      .update(actionTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(actionTokens.tenantId, tenantId),
          eq(actionTokens.purpose, "password_reset"),
          eq(actionTokens.tokenHash, tokenHash),
          isNull(actionTokens.usedAt),
          gt(actionTokens.expiresAt, new Date()),
        ),
      )
      .returning({ id: actionTokens.id, targetId: actionTokens.targetId });

    if (!consumed) {
      throw new Error("Invalid or expired password reset link");
    }

    // Update customer password and set emailVerified = true, isGuest = false (password reset / account setup confirms email control)
    await tx
      .update(customers)
      .set({ passwordHash: newHash, emailVerified: true, isGuest: false, updatedAt: new Date() })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, consumed.targetId)));

    return consumed.targetId;
  });

  // Invalidate all active customer sessions
  await destroyAllCustomerSessions(db, tenantId, customerId);

  // Send password_changed confirmation email
  try {
    const [cust] = await withTenant(db, tenantId, async (tx) =>
      tx
        .select({ email: customers.email })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId))),
    );

    if (cust?.email) {
      const brand = await loadEmailBrand(db, tenantId);
      const { html, text } = renderEmail(
        "password_changed",
        brand,
        {},
        "Your password was changed",
      );

      queueMicrotask(async () => {
        try {
          await sendPlatformEmail(db, {
            tenantId,
            to: cust.email,
            subject: `Your ${brand.storeName} password was changed`,
            html,
            text,
            fromName: brand.storeName,
            replyTo: brand.supportEmail ?? undefined,
            template: "password_changed",
          });
        } catch (err) {
          logger.error({ err, customerId, tenantId }, "Failed to send password changed email");
        }
      });
    }
  } catch (err) {
    logger.error({ err, customerId, tenantId }, "Failed to prepare password changed email");
  }

  return { success: true };
}

/**
 * Change customer password for a signed-in customer (PLAN §5.2).
 * Verifies current password, updates to next password, revokes other sessions.
 */
export async function changeCustomerPassword(
  db: Db,
  tenantId: string,
  params: {
    customerId: string;
    currentPassword: string;
    nextPassword: string;
    currentSessionToken?: string | undefined;
    revokeOtherSessions?: boolean | undefined;
  },
): Promise<{ success: boolean }> {
  validateCustomerPassword(params.nextPassword);

  await withTenant(db, tenantId, async (tx) => {
    const [cust] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, params.customerId), eq(customers.status, "active")));

    if (!cust || !cust.passwordHash) {
      throw new Error("Account has no password set or is not found");
    }

    const currentOk = await verifyPassword({
      hash: cust.passwordHash,
      password: params.currentPassword,
    });

    if (!currentOk) {
      throw new Error("Current password is incorrect");
    }

    const newHash = await hashPassword(params.nextPassword);
    await tx
      .update(customers)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, params.customerId)));
  });

  if (params.revokeOtherSessions !== false && params.currentSessionToken) {
    await destroyOtherCustomerSessions(db, tenantId, params.customerId, params.currentSessionToken);
  }

  // Send security notice email
  try {
    const [cust] = await withTenant(db, tenantId, async (tx) =>
      tx
        .select({ email: customers.email })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.id, params.customerId))),
    );

    if (cust?.email) {
      const brand = await loadEmailBrand(db, tenantId);
      const { html, text } = renderEmail(
        "password_changed",
        brand,
        {},
        "Your password was changed",
      );

      queueMicrotask(async () => {
        try {
          await sendPlatformEmail(db, {
            tenantId,
            to: cust.email,
            subject: `Your ${brand.storeName} password was changed`,
            html,
            text,
            fromName: brand.storeName,
            replyTo: brand.supportEmail ?? undefined,
            template: "password_changed",
          });
        } catch (err) {
          logger.error({ err, customerId: params.customerId, tenantId }, "Failed to send password changed notice");
        }
      });
    }
  } catch (err) {
    logger.error({ err, customerId: params.customerId, tenantId }, "Failed to prepare password changed notice");
  }

  return { success: true };
}
