import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { type Db, withTenant, idempotencyKeys } from "@bs/db";

export class IdempotencyConflictError extends Error {
  constructor(message = "Idempotency key was previously used with a different request payload") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyInFlightError extends Error {
  constructor(message = "A request with this idempotency key is currently in progress") {
    super(message);
    this.name = "IdempotencyInFlightError";
  }
}

export interface IdempotencyResult<T> {
  status: number;
  body: T;
  cached: boolean;
}

export function hashPayload(payload: unknown): string {
  if (payload === undefined || payload === null) return createHash("sha256").update("").digest("hex");
  const str = typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHash("sha256").update(str).digest("hex");
}

/**
 * Executes a mutation with guaranteed idempotency per tenant, route, and key (PLAN §5.10).
 *
 * Guarantees:
 * - Exactly once execution for identical key + payload
 * - Replay returns identical cached status and response body
 * - Divergent payloads with the same key throw IdempotencyConflictError
 * - Concurrent in-flight requests throw IdempotencyInFlightError
 */
export async function withIdempotencyKey<T>(
  db: Db,
  tenantId: string,
  route: string,
  key: string,
  requestPayload: unknown,
  fn: (tx: Db) => Promise<{ status: number; body: T }>,
  opts?: {
    ttlHours?: number | undefined;
    lockTimeoutSeconds?: number | undefined;
    inFlightWaitTimeoutMs?: number | undefined;
  },
): Promise<IdempotencyResult<T>> {
  const requestHash = hashPayload(requestPayload);
  const ttlHours = opts?.ttlHours ?? 24;
  const lockTimeoutSeconds = opts?.lockTimeoutSeconds ?? 30;
  const inFlightWaitTimeoutMs = opts?.inFlightWaitTimeoutMs ?? 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < inFlightWaitTimeoutMs) {
    // 1. In a brief transaction, inspect or acquire lock
    const outcome = await withTenant(db, tenantId, async (tx) => {
      const insertRes = await tx.execute<{ id: string }>(sql`
        INSERT INTO idempotency_keys (tenant_id, key, route, request_hash, locked_until, expires_at)
        VALUES (
          ${tenantId},
          ${key},
          ${route},
          ${requestHash},
          now() + (${lockTimeoutSeconds} * interval '1 second'),
          now() + (${ttlHours} * interval '1 hour')
        )
        ON CONFLICT (tenant_id, key, route) DO NOTHING
        RETURNING id;
      `);

      if (insertRes.rows.length > 0) {
        return { kind: "acquired" as const };
      }

      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.tenantId, tenantId),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.route, route),
          ),
        );

      if (!existing) {
        throw new Error(`Unexpected idempotency key state for ${key}`);
      }

      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError();
      }

      if (existing.responseStatus != null) {
        return {
          kind: "cached" as const,
          status: existing.responseStatus,
          body: existing.responseBody as T,
        };
      }

      if (existing.lockedUntil && existing.lockedUntil.getTime() > Date.now()) {
        return { kind: "in_flight" as const };
      }

      // Stale lock recovery
      await tx
        .update(idempotencyKeys)
        .set({
          lockedUntil: new Date(Date.now() + lockTimeoutSeconds * 1000),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(idempotencyKeys.tenantId, tenantId),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.route, route),
          ),
        );

      return { kind: "acquired" as const };
    });

    if (outcome.kind === "cached") {
      return {
        status: outcome.status,
        body: outcome.body,
        cached: true,
      };
    }

    if (outcome.kind === "acquired") {
      return await withTenant(db, tenantId, async (tx) => {
        try {
          const result = await fn(tx);
          await tx
            .update(idempotencyKeys)
            .set({
              responseStatus: result.status,
              responseBody: result.body,
              lockedUntil: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(idempotencyKeys.tenantId, tenantId),
                eq(idempotencyKeys.key, key),
                eq(idempotencyKeys.route, route),
              ),
            );

          return {
            status: result.status,
            body: result.body,
            cached: false,
          };
        } catch (err) {
          await tx
            .delete(idempotencyKeys)
            .where(
              and(
                eq(idempotencyKeys.tenantId, tenantId),
                eq(idempotencyKeys.key, key),
                eq(idempotencyKeys.route, route),
              ),
            );
          throw err;
        }
      });
    }

    // In-flight: wait briefly outside transaction so the connection is returned to the pool
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new IdempotencyInFlightError();
}

/**
 * Periodically deletes expired idempotency key entries (PLAN §5.10).
 */
export async function cleanupExpiredIdempotencyKeys(
  db: Db,
  tenantId?: string | undefined,
): Promise<{ deletedCount: number }> {
  if (tenantId) {
    return await withTenant(db, tenantId, async (tx) => {
      const res = await tx.execute<{ count: string }>(sql`
        WITH deleted AS (
          DELETE FROM idempotency_keys
           WHERE tenant_id = ${tenantId}
             AND expires_at < now()
          RETURNING 1
        )
        SELECT count(*)::text AS count FROM deleted;
      `);
      return { deletedCount: Number(res.rows[0]?.count ?? 0) };
    });
  }

  const res = await db.execute<{ count: string }>(sql`
    WITH deleted AS (
      DELETE FROM idempotency_keys
       WHERE expires_at < now()
      RETURNING 1
    )
    SELECT count(*)::text AS count FROM deleted;
  `);
  return { deletedCount: Number(res.rows[0]?.count ?? 0) };
}
