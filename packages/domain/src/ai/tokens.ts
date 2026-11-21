/**
 * AI connection tokens (ADR-050, docs/MCP-PLAN.md section 14). Opaque random strings with recognisable prefixes so secret
 * scanning can catch a leak; only the SHA-256 is stored. Access tokens last one hour, refresh tokens thirty days and rotate:
 * using an old refresh token again revokes the whole chain (reuse detection).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";

export const ACCESS_TOKEN_PREFIX = "bsat_";
export const REFRESH_TOKEN_PREFIX = "bsrt_";
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_target"
  | "access_denied";

/** An OAuth protocol error with the RFC 6749 code, mapped to a JSON error response by the HTTP layer. */
export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly status: number;
  constructor(code: OAuthErrorCode, description: string, status = 400) {
    super(description);
    this.name = "OAuthError";
    this.code = code;
    this.status = status;
  }
}

export function hashAiToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Issues an access and a refresh token for a connection. `family` ties a refresh chain together. */
export async function issueTokenPair(db: Db, input: { tenantId: string; connectionId: string; family?: string }): Promise<TokenPair> {
  const family = input.family ?? randomUUID();
  const accessToken = newToken(ACCESS_TOKEN_PREFIX);
  const refreshToken = newToken(REFRESH_TOKEN_PREFIX);
  const now = Date.now();
  await db.insert(schema.agentTokens).values([
    {
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      kind: "access",
      tokenHash: hashAiToken(accessToken),
      family,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
    },
    {
      tenantId: input.tenantId,
      connectionId: input.connectionId,
      kind: "refresh",
      tokenHash: hashAiToken(refreshToken),
      family,
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  ]);
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export interface AccessTokenInfo {
  tenantId: string;
  connectionId: string;
}

/** Resolves a bearer access token to its connection, or null when it is unknown, expired, revoked or not an access token. */
export async function resolveAccessToken(db: Db, raw: string): Promise<AccessTokenInfo | null> {
  if (!raw.startsWith(ACCESS_TOKEN_PREFIX) || raw.length > 200) return null;
  const [row] = await db
    .select({ tenantId: schema.agentTokens.tenantId, connectionId: schema.agentTokens.connectionId })
    .from(schema.agentTokens)
    .where(
      and(
        eq(schema.agentTokens.tokenHash, hashAiToken(raw)),
        eq(schema.agentTokens.kind, "access"),
        isNull(schema.agentTokens.revokedAt),
        sql`${schema.agentTokens.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Revokes every token of a connection (revoke, abuse pause, plan downgrade, staff removal). */
export async function revokeConnectionTokens(db: Db, tenantId: string, connectionId: string): Promise<void> {
  await db
    .update(schema.agentTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.agentTokens.tenantId, tenantId), eq(schema.agentTokens.connectionId, connectionId), isNull(schema.agentTokens.revokedAt)));
}

/**
 * Treats a token as stolen: the connection is revoked (the merchant sees it vanish from Connected apps and must connect again)
 * and every token it holds stops working. Used when a refresh token or an authorization code is presented a second time.
 */
export async function revokeConnectionAsCompromised(db: Db, tenantId: string, connectionId: string): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx
      .update(schema.agentConnections)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(schema.agentConnections.tenantId, tenantId), eq(schema.agentConnections.id, connectionId), eq(schema.agentConnections.status, "active")));
  });
  await revokeConnectionTokens(db, tenantId, connectionId);
}

/**
 * Exchanges a refresh token for a new pair. The old refresh token is marked rotated in the same atomic step that claims it, so two
 * parallel refreshes cannot both win. Presenting a rotated or revoked refresh token is treated as theft: the whole family is revoked.
 */
export async function rotateRefreshToken(db: Db, raw: string, clientId: string): Promise<TokenPair> {
  if (!raw.startsWith(REFRESH_TOKEN_PREFIX) || raw.length > 200) throw new OAuthError("invalid_grant", "The refresh token is not valid.");
  const hash = hashAiToken(raw);
  const [row] = await db.select().from(schema.agentTokens).where(and(eq(schema.agentTokens.tokenHash, hash), eq(schema.agentTokens.kind, "refresh"))).limit(1);
  if (!row) throw new OAuthError("invalid_grant", "The refresh token is not valid.");
  if (row.rotatedAt || row.revokedAt) {
    await db.update(schema.agentTokens).set({ revokedAt: new Date() }).where(and(eq(schema.agentTokens.family, row.family), isNull(schema.agentTokens.revokedAt)));
    if (row.rotatedAt) await revokeConnectionAsCompromised(db, row.tenantId, row.connectionId);
    throw new OAuthError("invalid_grant", "The refresh token is not valid.");
  }
  if (row.expiresAt.getTime() <= Date.now()) throw new OAuthError("invalid_grant", "The refresh token has expired.");

  const connection = await withTenant(db, row.tenantId, async (tx) => {
    const [c] = await tx
      .select({ status: schema.agentConnections.status, clientId: schema.agentConnections.clientId })
      .from(schema.agentConnections)
      .where(and(eq(schema.agentConnections.tenantId, row.tenantId), eq(schema.agentConnections.id, row.connectionId)))
      .limit(1);
    return c;
  });
  if (!connection || connection.status === "revoked") throw new OAuthError("invalid_grant", "The connection was revoked.");
  if (connection.clientId !== clientId) throw new OAuthError("invalid_grant", "The refresh token was issued to a different app.");

  const claimed = await db
    .update(schema.agentTokens)
    .set({ rotatedAt: new Date() })
    .where(and(eq(schema.agentTokens.id, row.id), isNull(schema.agentTokens.rotatedAt), isNull(schema.agentTokens.revokedAt)))
    .returning({ id: schema.agentTokens.id });
  if (claimed.length === 0) {
    await db.update(schema.agentTokens).set({ revokedAt: new Date() }).where(and(eq(schema.agentTokens.family, row.family), isNull(schema.agentTokens.revokedAt)));
    await revokeConnectionAsCompromised(db, row.tenantId, row.connectionId);
    throw new OAuthError("invalid_grant", "The refresh token is not valid.");
  }
  return issueTokenPair(db, { tenantId: row.tenantId, connectionId: row.connectionId, family: row.family });
}

/** RFC 7009: revokes the token's whole family. Unknown tokens are ignored (the endpoint always answers 200). */
export async function revokeToken(db: Db, raw: string): Promise<void> {
  if (raw.length > 200) return;
  const [row] = await db.select({ family: schema.agentTokens.family }).from(schema.agentTokens).where(eq(schema.agentTokens.tokenHash, hashAiToken(raw))).limit(1);
  if (!row) return;
  await db.update(schema.agentTokens).set({ revokedAt: new Date() }).where(and(eq(schema.agentTokens.family, row.family), isNull(schema.agentTokens.revokedAt)));
}
