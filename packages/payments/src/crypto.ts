import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * Normalizes an encryption key into a 32-byte Buffer.
 */
function normalizeKey(key?: string): Buffer {
  const master = key ?? process.env.TENANT_SECRETS_KEY ?? process.env.ENCRYPTION_KEY;
  if (!master) {
    if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
      throw new Error(
        "Encryption key not set: TENANT_SECRETS_KEY or ENCRYPTION_KEY is required in production (PLAN §4)",
      );
    }
    return createHash("sha256").update("dev_default_secret_key_32_bytes_long_!").digest();
  }
  if (master.length === 64 && /^[0-9a-fA-F]+$/.test(master)) {
    return Buffer.from(master, "hex");
  }
  return createHash("sha256").update(master).digest();
}

export function assertProductionEncryptionKeySet(): void {
  const isProd = process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProd && !process.env.TENANT_SECRETS_KEY && !process.env.ENCRYPTION_KEY) {
    throw new Error(
      "Encryption key not set: TENANT_SECRETS_KEY or ENCRYPTION_KEY is required in production (PLAN §4)",
    );
  }
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

/**
 * Encrypts a plaintext secret using AES-256-GCM.
 */
export function encryptSecret(plaintext: string, secretKey?: string): EncryptedSecret {
  const key = normalizeKey(secretKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Combine encrypted data and auth tag in ciphertext (hex)
  const combined = Buffer.concat([encrypted, tag]).toString("hex");

  return {
    ciphertext: combined,
    iv: iv.toString("hex"),
    keyVersion: 1,
  };
}

/**
 * Decrypts an encrypted secret using AES-256-GCM.
 */
export function decryptSecret(encrypted: { ciphertext: string; iv: string }, secretKey?: string): string {
  const key = normalizeKey(secretKey);
  const iv = Buffer.from(encrypted.iv, "hex");
  const combined = Buffer.from(encrypted.ciphertext, "hex");

  if (combined.length < 16) {
    throw new Error("Invalid ciphertext: too short for auth tag");
  }

  // Tag is the last 16 bytes
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(0, combined.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
