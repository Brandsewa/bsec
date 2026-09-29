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
  opts?: { ttlHours?: number | undefined; lockTimeoutSeconds?: number | undefined },
): Promise<IdempotencyResult<T>> {
  const requestHash = hashPayload(requestPayload);
  const ttlHours = opts?.ttlHours ?? 24;
  const lockTimeoutSeconds = opts?.lockTimeoutSeconds ?? 30;

  return await withTenant(db, tenantId, async (tx) => {
    // 1. Try to atomically acquire lock via INSERT ... ON CONFLICT DO NOTHING
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
      // We acquired lock
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
        // Unlock on error so client can retry
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
    }

    // 2. Conflict occurred: inspect existing record
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
        status: existing.responseStatus,
        body: existing.responseBody as T,
        cached: true,
      };
    }

    if (existing.lockedUntil && existing.lockedUntil.getTime() > Date.now()) {
      throw new IdempotencyInFlightError();
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
