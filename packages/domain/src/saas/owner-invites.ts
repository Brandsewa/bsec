import { createHash } from "node:crypto";
import { eq, and, sql, desc } from "drizzle-orm";
import { schema } from "@bs/db";
import { hashPassword, STORE_PERMISSIONS, verifyPassword } from "@bs/auth";
import { saasDb, type Runtime } from "../runtime.ts";
import { provisionTenant, type ProvisionTenantResult } from "./provisioning.ts";
import { buildOwnerInviteUrl, issueOwnerInviteInTx } from "./invite-token.ts";

export interface CreateOwnerInviteInput {
  tenantId: string;
  email: string;
  invitedBy?: string | undefined;
}

export interface CreateOwnerInviteResult {
  inviteId: string;
  tenantId: string;
  email: string;
  inviteToken: string;
  expiresAt: Date;
  inviteUrl: string;
}

export interface AcceptOwnerInviteInput {
  token: string;
  password: string;
  name?: string | undefined;
}

export interface AcceptOwnerInviteResult {
  success: boolean;
  tenantId: string;
  slug: string;
  userId: string;
  email: string;
  adminUrl: string;
}

export interface PlatformCreateTenantInput {
  storeName: string;
  slug: string;
  clientEmail: string;
  clientName?: string | undefined;
  clientPhone?: string | undefined;
  planCode?: "starter" | "growth" | "pro" | string | undefined;
  themeTemplate?: "starter-minimal" | "fashion-editorial" | "gourmet-artisan" | string | undefined;
  currency?: string | undefined;
  timezone?: string | undefined;
  state?: "trial" | "active" | "comped" | undefined;
}

export interface PlatformCreateTenantResult extends ProvisionTenantResult {
  inviteToken: string;
  inviteUrl: string;
  inviteExpiresAt: Date;
}

export interface ResendOwnerInviteInput {
  tenantId: string;
  email?: string | undefined;
  staffUserId?: string | undefined;
}

/**
 * Generates a cryptographically random, single-use, hashed owner invite token (PLAN §6).
 * Expires after 7 days. Revokes any existing unused invites for this tenant.
 */
export async function createTenantOwnerInvite(
  rt: Runtime,
  input: CreateOwnerInviteInput,
): Promise<CreateOwnerInviteResult> {
  const issued = await saasDb(rt).transaction((tx) =>
    issueOwnerInviteInTx(tx, { tenantId: input.tenantId, email: input.email, invitedBy: input.invitedBy, action: "tenant.invite_created" }),
  );
  return {
    inviteId: issued.inviteId,
    tenantId: input.tenantId,
    email: issued.email,
    inviteToken: issued.rawToken,
    expiresAt: issued.expiresAt,
    inviteUrl: buildOwnerInviteUrl(issued.rawToken),
  };
}

/**
 * Accepts a store owner invitation, sets up their password account, and activates membership.
 */
export async function acceptTenantOwnerInvite(
  rt: Runtime,
  input: AcceptOwnerInviteInput,
): Promise<AcceptOwnerInviteResult> {
  const db = saasDb(rt);
  const rawToken = input.token.trim();
  if (!rawToken || rawToken.length < 16) {
    throw new Error("Invalid or missing invitation token");
  }

  if (!input.password || input.password.length < 10) {
    throw new Error("Password must be at least 10 characters long");
  }

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  return await db.transaction(async (tx) => {
    // 1. Atomically claim invite record (UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING ...)
    const [invite] = await tx
      .update(schema.tenantOwnerInvites)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.tenantOwnerInvites.tokenHash, tokenHash),
          sql`${schema.tenantOwnerInvites.expiresAt} > now()`,
          sql`${schema.tenantOwnerInvites.usedAt} IS NULL`,
        ),
      )
      .returning();

    if (!invite) {
      throw new Error("Invitation token is invalid, expired, or has already been used");
    }

    const tenantId = invite.tenantId;
    const email = invite.email.toLowerCase();

    // 2. Fetch tenant metadata
    const [tenant] = await tx
      .select({ id: schema.tenants.id, slug: schema.tenants.slug, name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      throw new Error("Associated store not found");
    }

    // 3. Find or create User
    let userId: string;
    const [existingUser] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existingUser) {
      // The person already has an account: they prove it is theirs with their CURRENT password.
      // Whoever merely holds the invite link (including platform staff who created it) can neither
      // reset that password nor mark the email verified.
      userId = existingUser.id;
      const cred = await tx.execute<{ password: string | null }>(sql`
        SELECT password FROM accounts WHERE user_id = ${userId} AND provider_id = 'credential' LIMIT 1;
      `);
      const storedHash = cred.rows[0]?.password;
      if (storedHash) {
        const ok = await verifyPassword({ hash: storedHash, password: input.password });
        if (!ok) throw new Error("Incorrect password for the existing account with this email");
      } else {
        // No password yet. That is legitimate only for the pending owner the platform created for this invite
        // (unverified email, no sign-in method at all). An account that already exists in its own right
        // (verified email, or another sign-in method) cannot be claimed with the link alone.
        const info = await tx.execute<{ email_verified: boolean; accounts: string }>(sql`
          SELECT u.email_verified, (SELECT count(*)::text FROM accounts a WHERE a.user_id = u.id) AS accounts
          FROM users u WHERE u.id = ${userId};
        `);
        const pending = info.rows[0]?.email_verified === false && info.rows[0]?.accounts === "0";
        if (!pending) {
          throw new Error("An account with this email already exists. Sign in with your existing method to access the store.");
        }
        await tx.insert(schema.accounts).values({
          id: crypto.randomUUID(),
          userId,
          accountId: userId,
          providerId: "credential",
          password: await hashPassword(input.password),
        });
      }
    } else {
      const [newUser] = await tx
        .insert(schema.users)
        .values({
          email,
          name: input.name?.trim() || email.split("@")[0] || "Store Owner",
          emailVerified: true,
        })
        .returning({ id: schema.users.id });
      if (!newUser) {
        throw new Error("Failed to create user record");
      }
      userId = newUser.id;
      await tx.insert(schema.accounts).values({
        id: crypto.randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: await hashPassword(input.password),
      });
    }

    // 5. Ensure Owner role and membership
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

    let ownerRoleId: string;
    const [existingRole] = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, "store_owner")))
      .limit(1);

    if (existingRole) {
      ownerRoleId = existingRole.id;
    } else {
      const [newRole] = await tx
        .insert(schema.roles)
        .values({
          tenantId,
          name: "store_owner",
          isSystem: true,
          permissions: [...STORE_PERMISSIONS],
        })
        .returning({ id: schema.roles.id });
      if (!newRole) {
        throw new Error("Failed to create owner role record");
      }
      ownerRoleId = newRole.id;
    }

    // Upsert membership
    await tx
      .insert(schema.memberships)
      .values({
        tenantId,
        userId,
        roleId: ownerRoleId,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [schema.memberships.tenantId, schema.memberships.userId],
        set: { roleId: ownerRoleId, status: "active", updatedAt: new Date() },
      });

    // Set owner on tenant
    await tx
      .update(schema.tenants)
      .set({ ownerUserId: userId, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));

    // 6. Audit log (invite token was already atomically marked used in step 1)
    await tx.insert(schema.platformAuditLogs).values({
      actorUserId: userId,
      actorType: "system",
      action: "tenant.invite_accepted",
      targetType: "tenant",
      targetId: tenantId,
      tenantId,
      diff: { email, slug: tenant.slug },
    });

    const platformDomain = process.env.PLATFORM_DOMAIN?.trim() || "gobs.cloud";
    const isLocal = platformDomain.includes("localhost") || platformDomain.includes("127.0.0.1");
    const protocol = isLocal ? "http" : "https";
    const adminHost = process.env.ADMIN_HOST?.trim() || (isLocal ? "localhost:5173" : `admin.${platformDomain}`);
    const adminUrl = `${protocol}://${adminHost}/?store=${tenant.slug}`;

    return {
      success: true,
      tenantId,
      slug: tenant.slug,
      userId,
      email,
      adminUrl,
    };
  });
}

/**
 * Platform operator procedure: creates a store for a client and generates an owner invite (PLAN §6).
 */
export async function platformCreateTenantForClient(
  rt: Runtime,
  input: PlatformCreateTenantInput,
  platformStaffUserId?: string,
): Promise<PlatformCreateTenantResult> {
  // Store, owner, membership, defaults, the owner's single-use invite and the audit row (actor = the staff member)
  // are ONE transaction: either the client gets a complete store with a working invite, or nothing is created.
  const provisionResult = await provisionTenant(rt, {
    storeName: input.storeName,
    slug: input.slug,
    owner: {
      email: input.clientEmail,
      name: input.clientName || input.clientEmail.split("@")[0] || "Store Owner",
      phone: input.clientPhone,
    },
    planCode: input.planCode || "growth",
    themeTemplate: input.themeTemplate || "starter-minimal",
    currency: input.currency || "INR",
    timezone: input.timezone || "Asia/Kolkata",
    source: "platform_admin",
    actorUserId: platformStaffUserId,
    issueOwnerInvite: true,
    subscriptionState: input.state,
  });
  const invite = provisionResult.ownerInvite;
  if (!invite) throw new Error("Failed to issue the owner invite");

  return {
    ...provisionResult,
    inviteToken: invite.token,
    inviteUrl: invite.url,
    inviteExpiresAt: invite.expiresAt,
  };
}

/**
 * Resends a tenant owner invitation, invalidating all prior unaccepted invites for this store (PLAN §6 / S4).
 */
export async function resendTenantOwnerInvite(
  rt: Runtime,
  input: ResendOwnerInviteInput,
): Promise<CreateOwnerInviteResult> {
  const issued = await saasDb(rt).transaction(async (tx) => {
    // The recipient must be the one this store was originally invited (a resend cannot redirect the store to a new mailbox)
    const [prevInvite] = await tx
      .select({ email: schema.tenantOwnerInvites.email })
      .from(schema.tenantOwnerInvites)
      .where(eq(schema.tenantOwnerInvites.tenantId, input.tenantId))
      .orderBy(desc(schema.tenantOwnerInvites.createdAt))
      .limit(1);
    if (!prevInvite?.email) throw new Error("Unable to determine invite recipient email for this store");
    const email = prevInvite.email.toLowerCase();
    if (input.email && input.email.trim().toLowerCase() !== email) {
      throw new Error("Email does not match the store's original invite recipient");
    }
    return issueOwnerInviteInTx(tx, { tenantId: input.tenantId, email, invitedBy: input.staffUserId, action: "tenant.invite_resent" });
  });
  return {
    inviteId: issued.inviteId,
    tenantId: input.tenantId,
    email: issued.email,
    inviteToken: issued.rawToken,
    expiresAt: issued.expiresAt,
    inviteUrl: buildOwnerInviteUrl(issued.rawToken),
  };
}
