import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { schema, type Db } from "@bs/db";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

/** The link a store owner opens to set their password and enter their store admin. */
export function buildOwnerInviteUrl(rawToken: string): string {
  const platformDomain = process.env.PLATFORM_DOMAIN?.trim() || "bcom.si";
  const isLocal = platformDomain.includes("localhost") || platformDomain.includes("127.0.0.1");
  const protocol = isLocal ? "http" : "https";
  const adminHost = process.env.ADMIN_HOST?.trim() || (isLocal ? "localhost:5173" : `admin.${platformDomain}`);
  return `${protocol}://${adminHost}/accept-invite?token=${rawToken}`;
}

export interface IssuedOwnerInvite {
  inviteId: string;
  email: string;
  rawToken: string;
  expiresAt: Date;
}

/**
 * Issues a fresh single-use owner invite INSIDE the caller's transaction: earlier unused invites for the store are
 * revoked, only the SHA-256 of the token is stored, and the audit row is written in the same transaction.
 * The raw token is returned once to the caller and never stored.
 */
export async function issueOwnerInviteInTx(
  tx: Db,
  input: { tenantId: string; email: string; invitedBy?: string | undefined; action?: "tenant.invite_created" | "tenant.invite_resent" },
): Promise<IssuedOwnerInvite> {
  const email = input.email.trim().toLowerCase();
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await tx.execute(sql`
    UPDATE tenant_owner_invites
       SET expires_at = now()
     WHERE tenant_id = ${input.tenantId} AND used_at IS NULL AND expires_at > now()
  `);

  const [invite] = await tx
    .insert(schema.tenantOwnerInvites)
    .values({ tenantId: input.tenantId, email, tokenHash, expiresAt })
    .returning({ id: schema.tenantOwnerInvites.id });
  if (!invite) throw new Error("Failed to create tenant owner invite");

  await tx.insert(schema.platformAuditLogs).values({
    actorUserId: input.invitedBy ?? null,
    actorType: input.invitedBy ? "platform_staff" : "system",
    action: input.action ?? "tenant.invite_created",
    targetType: "tenant",
    targetId: input.tenantId,
    tenantId: input.tenantId,
    diff: { email, expiresAt },
  });

  return { inviteId: invite.id, email, rawToken, expiresAt };
}
