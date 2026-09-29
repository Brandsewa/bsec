import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { encryptSecret, decryptSecret } from "../src/crypto.ts";

describe("payments crypto (PLAN §4, M6 hardening)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TENANT_SECRETS_KEY;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.APP_ENV;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("encrypts and decrypts secret in non-production with default dev key", () => {
    const plaintext = "test_razorpay_secret_123";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("encrypts and decrypts with an explicitly supplied secret key", () => {
    const customKey = "a_very_secure_custom_key_for_payments_32_bytes";
    const plaintext = "super_secret_payment_key";
    const encrypted = encryptSecret(plaintext, customKey);
    const decrypted = decryptSecret(encrypted, customKey);
    expect(decrypted).toBe(plaintext);
  });

  it("throws in production when APP_ENV=production and no key is set", () => {
    process.env.APP_ENV = "production";
    expect(() => encryptSecret("my_secret")).toThrowError(
      /Encryption key not set: TENANT_SECRETS_KEY or ENCRYPTION_KEY is required in production/,
    );
  });

  it("throws in production when NODE_ENV=production and no key is set", () => {
    process.env.NODE_ENV = "production";
    expect(() => decryptSecret({ ciphertext: "abcd", iv: "1234" })).toThrowError(
      /Encryption key not set: TENANT_SECRETS_KEY or ENCRYPTION_KEY is required in production/,
    );
  });

  it("succeeds in production when TENANT_SECRETS_KEY is set", () => {
    process.env.APP_ENV = "production";
    process.env.TENANT_SECRETS_KEY = "prod_secret_master_key_for_payments_tests";
    const plaintext = "production_api_token";
    const encrypted = encryptSecret(plaintext);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("succeeds in production when ENCRYPTION_KEY is set", () => {
    process.env.NODE_ENV = "production";
    process.env.ENCRYPTION_KEY = "prod_encryption_master_key_for_payments_tests";
    const plaintext = "production_encryption_key_token";
    const encrypted = encryptSecret(plaintext);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });
});
