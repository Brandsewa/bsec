import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "../src/crypto.ts";

describe("AES-256-GCM Tenant Secret Encryption", () => {
  const masterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 32-byte hex

  it("encrypts and decrypts secret correctly", () => {
    const secret = "rzp_live_secret_key_123456789";
    const encrypted = encryptSecret(secret, masterKey);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext).not.toEqual(secret);

    const decrypted = decryptSecret(encrypted, masterKey);
    expect(decrypted).toBe(secret);
  });

  it("fails to decrypt if ciphertext is tampered", () => {
    const secret = "rzp_live_secret_key_123456789";
    const encrypted = encryptSecret(secret, masterKey);
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + "abcd" };

    expect(() => decryptSecret(tampered, masterKey)).toThrow();
  });

  it("fails to decrypt with incorrect key", () => {
    const secret = "rzp_live_secret_key_123456789";
    const encrypted = encryptSecret(secret, masterKey);
    const wrongKey = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    expect(() => decryptSecret(encrypted, wrongKey)).toThrow();
  });
});
