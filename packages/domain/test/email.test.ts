import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sendTransactionalEmail } from "../src/system/email.ts";
import { setPlatformEmailTransportFactory, sanitizeError } from "../src/system/platform-mailer.ts";
import type { Db } from "@bs/db";

interface MockRow {
  status?: string;
  error?: string | null;
  providerId?: string;
  sentAt?: unknown;
}

describe("sendTransactionalEmail() with platform mailer", () => {
  beforeEach(() => {
    setPlatformEmailTransportFactory(null);
  });

  afterEach(() => {
    setPlatformEmailTransportFactory(null);
    vi.restoreAllMocks();
  });

  function createMockDb(options: {
    featureFlags?: Array<{ defaultOn?: boolean; killSwitch?: boolean }>;
    platformEmailSettings?: Array<{
      id: string;
      provider: string;
      host: string;
      port: number;
      secureMode: string;
      username: string;
      passwordCiphertext?: string | null;
      passwordIv?: string | null;
      keyVersion: number;
      fromEmail: string;
      fromName: string;
      replyTo?: string | null;
      enabled: boolean;
    }>;
    insertedId?: string;
    onUpdate?: (val: MockRow) => void;
  }) {
    const insertedId = options.insertedId ?? "0199a000-0000-7000-8000-000000000099";
    const tx = {
      execute: async () => ({ rows: [] }),
      select: (fields: unknown) => ({
        from: (tbl: unknown) => ({
          where: () => {
            const chain = (rows: unknown[] = []) => ({
              limit: async () => rows,
              orderBy: () => ({ limit: async () => rows }),
            });

            const isFeatureFlag =
              Boolean((tbl as { key?: unknown })?.key !== undefined) ||
              Object.keys((fields ?? {}) as object).includes("killSwitch");
            if (isFeatureFlag) {
              return chain(options.featureFlags ?? []);
            }
            if (Object.keys((fields ?? {}) as object).includes("host") || (tbl as { id?: unknown })?.id !== undefined) {
              return chain(options.platformEmailSettings ?? []);
            }
            return chain([]);
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
      insert: tx.insert,
      update: tx.update,
      transaction: async (fn: (innerTx: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as Db;
  }

  it("marks status as failed when platform email service is unconfigured or disabled", async () => {
    let updatedRow: MockRow | null = null;

    const mockDb = createMockDb({
      platformEmailSettings: [], // empty -> unconfigured
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
    expect(result.error).toContain("Email service not configured");
    expect(updatedRow).not.toBeNull();
    expect((updatedRow as MockRow | null)?.status).toBe("failed");
  });

  it("sanitizes secrets from error messages", () => {
    const secret = "secret_zepto_token_xyz999";
    const rawError = new Error(`Connection failed with token: ${secret}`);
    const sanitized = sanitizeError(rawError, secret);
    expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain("[REDACTED]");
  });
});
