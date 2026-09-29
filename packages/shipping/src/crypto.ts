import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function normalizeKey(key?: string): Buffer {
  const master = key ?? process.env.TENANT_SECRETS_KEY ?? process.env.ENCRYPTION_KEY ?? "dev_default_secret_key_32_bytes_long_!";
  if (master.length === 64 && /^[0-9a-fA-F]+$/.test(master)) {
    return Buffer.from(master, "hex");
  }
  return createHash("sha256").update(master).digest();
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

export function encryptSecret(plaintext: string, secretKey?: string): EncryptedSecret {
  const key = normalizeKey(secretKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, tag]).toString("hex");

  return {
    ciphertext: combined,
    iv: iv.toString("hex"),
    keyVersion: 1,
  };
}

export function decryptSecret(encrypted: { ciphertext: string; iv: string }, secretKey?: string): string {
  const key = normalizeKey(secretKey);
  const iv = Buffer.from(encrypted.iv, "hex");
  const combined = Buffer.from(encrypted.ciphertext, "hex");

  if (combined.length < 16) {
    throw new Error("Invalid ciphertext: too short for auth tag");
  }

  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(0, combined.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
