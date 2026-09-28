import { describe, expect, it, vi } from "vitest";
import { withTenant, type Db } from "../src/index.ts";

describe("withTenant()", () => {
  it("executes set_config parameterized within a transaction and returns fn result", async () => {
    const executedSqls: unknown[] = [];
    const mockTx = {
      execute: vi.fn(async (query: unknown) => {
        executedSqls.push(query);
        return { rows: [] };
      }),
    };

    const mockDb = {
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        return cb(mockTx);
      }),
    } as unknown as Db;

    const tenantId = "0199a000-0000-7000-8000-000000000001";
    const result = await withTenant(mockDb, tenantId, async (tx) => {
      expect(tx).toBe(mockTx);
      return { success: true };
    });

    expect(result).toEqual({ success: true });
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.execute).toHaveBeenCalledTimes(1);
  });

  it("propagates error when fn throws", async () => {
    const mockTx = {
      execute: vi.fn(async () => ({ rows: [] })),
    };
    const mockDb = {
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        return cb(mockTx);
      }),
    } as unknown as Db;

    const tenantId = "0199a000-0000-7000-8000-000000000001";
    await expect(
      withTenant(mockDb, tenantId, async () => {
        throw new Error("Transaction failed");
      }),
    ).rejects.toThrow("Transaction failed");
  });
});
