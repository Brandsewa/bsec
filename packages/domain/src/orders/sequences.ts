import { sql } from "drizzle-orm";
import { type Db, withTenant } from "@bs/db";

export interface SequenceAllocationOptions {
  defaultPrefix?: string | undefined;
  defaultPadding?: number | undefined;
  initialValue?: number | undefined;
}

export interface AllocatedSequence {
  raw: number;
  formatted: string;
  prefix: string;
  padding: number;
}

/**
 * Atomically allocates the next sequential number for a given tenant, kind, and scope (PLAN §11.2).
 * Uses atomic UPDATE ... SET next_value = next_value + 1 ... RETURNING.
 * Idempotently initializes the row if not present using INSERT ... ON CONFLICT DO NOTHING.
 */
export async function allocateSequenceNumber(
  db: Db,
  tenantId: string,
  kind: string,
  scope: string = "",
  options?: SequenceAllocationOptions,
): Promise<AllocatedSequence> {
  const prefix = options?.defaultPrefix ?? "";
  const padding = options?.defaultPadding ?? 4;
  const initialValue = options?.initialValue ?? 1;

  return await withTenant(db, tenantId, async (tx) => {
    // 1. Ensure the sequence row exists (idempotent, concurrency-safe)
    await tx.execute(sql`
      INSERT INTO number_sequences (tenant_id, kind, scope, prefix, next_value, padding)
      VALUES (${tenantId}, ${kind}, ${scope}, ${prefix}, ${initialValue}, ${padding})
      ON CONFLICT (tenant_id, kind, scope) DO NOTHING
    `);

    // 2. Atomically increment and return the allocated sequence value
    const result = await tx.execute<{
      allocated: string | number;
      prefix: string | null;
      padding: number | null;
    }>(sql`
      UPDATE number_sequences
         SET next_value = next_value + 1,
             updated_at = now()
       WHERE tenant_id = ${tenantId}
         AND kind = ${kind}
         AND scope = ${scope}
      RETURNING (next_value - 1) AS allocated, prefix, padding
    `);

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Failed to allocate sequence number for tenant=${tenantId}, kind=${kind}, scope=${scope}`);
    }

    const raw = Number(row.allocated);
    const rowPrefix = row.prefix ?? prefix;
    const rowPadding = Number(row.padding ?? padding);
    const formatted = `${rowPrefix}${raw.toString().padStart(rowPadding, "0")}`;

    return {
      raw,
      formatted,
      prefix: rowPrefix,
      padding: rowPadding,
    };
  });
}
