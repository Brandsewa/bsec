import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sendTransactionalEmail } from "../src/system/email.ts";
import type { Db } from "@bs/db";

interface MockRow {
  status?: string;
  error?: string | null;
  providerId?: string;
  sentAt?: unknown;
}

describe("sendTransactionalEmail()", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnvKey !== undefined) {
      process.env.RESEND_API_KEY = originalEnvKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
    vi.restoreAllMocks();
  });

  function createMockDb(options: {
    featureFlags?: Array<{ defaultOn?: boolean; killSwitch?: boolean }>;
    tenantSecrets?: Array<{ keyName: string; ciphertext: string; iv: string }>;
    insertedId?: string;
    onUpdate?: (val: MockRow) => void;
  }) {
    const insertedId = options.insertedId ?? "0199a000-0000-7000-8000-000000000099";
    const tx = {
      execute: async () => ({ rows: [] }),
      select: (fields: unknown) => ({
        from: (tbl: unknown) => ({
          where: () => {
            const isFeatureFlag =
              Boolean((tbl as { key?: unknown })?.key !== undefined) ||
              JSON.stringify(fields).includes("killSwitch");
            if (isFeatureFlag) {
              return { limit: async () => options.featureFlags ?? [] };
            }
            return Promise.resolve(options.tenantSecrets ?? []);
          },
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: async () => [{ id: insertedId }],
        }),
      }),
      update: () => ({
        set: (val: MockRow) => {
          options.onUpdate?.(val);
          return {
            where: async () => [{}],
          };
        },
      }),
    };

    return {
      select: tx.select,
      transaction: async (fn: (innerTx: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as Db;
  }

  it("marks status as failed when no Resend API key is configured", async () => {
    let updatedRow: MockRow | null = null;

    const mockDb = createMockDb({
      onUpdate: (val) => {
        updatedRow = val;
      },
    });

    const result = await sendTransactionalEmail(mockDb, {
      tenantId: "0199a000-0000-7000-8000-000000000001",
      template: "order_confirmation",
      toEmail: "customer@example.com",
      subject: "Order Confirmed",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("No Resend API key configured");
    expect(updatedRow?.status).toBe("failed");
    expect(updatedRow?.error).toContain("No Resend API key configured");
  });

  it("makes a real HTTP call to Resend and marks status as sent on 2xx response", async () => {
    process.env.RESEND_API_KEY = "re_test_123456";

    let updatedRow: MockRow | null = null;
    const mockDb = createMockDb({
      onUpdate: (val) => {
        updatedRow = val;
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "resend_msg_987654" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendTransactionalEmail(mockDb, {
      tenantId: "0199a000-0000-7000-8000-000000000001",
      template: "order_confirmation",
      toEmail: "customer@example.com",
      subject: "Order Confirmed",
      data: { orderNumber: "ORD-001" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_123456",
          "Content-Type": "application/json",
        }),
      }),
    );

    expect(result.status).toBe("sent");
    expect(result.providerId).toBe("resend_msg_987654");
    expect(updatedRow?.status).toBe("sent");
    expect(updatedRow?.providerId).toBe("resend_msg_987654");
  });

  it("marks status as failed when Resend API returns non-2xx error", async () => {
    process.env.RESEND_API_KEY = "re_test_invalid";

    let updatedRow: MockRow | null = null;
    const mockDb = createMockDb({
      onUpdate: (val) => {
        updatedRow = val;
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: "Invalid API key" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await sendTransactionalEmail(mockDb, {
      tenantId: "0199a000-0000-7000-8000-000000000001",
      template: "order_confirmation",
      toEmail: "customer@example.com",
      subject: "Order Confirmed",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Resend API error: 401");
    expect(updatedRow?.status).toBe("failed");
    expect(updatedRow?.error).toContain("Resend API error: 401");
  });
});
