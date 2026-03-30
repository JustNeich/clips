import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTION_ENV_NAME = "APP_ENCRYPTION_KEY";

function resolveEncryptionKey(): Buffer {
  const raw = process.env[ENCRYPTION_ENV_NAME]?.trim();
  if (raw) {
    try {
      const decoded = Buffer.from(raw, "base64");
      if (decoded.length === 32) {
        return decoded;
      }
    } catch {
      // fall through to hash fallback below
    }
    return createHash("sha256").update(raw).digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(`${ENCRYPTION_ENV_NAME} is required in production.`);
  }

  return createHash("sha256").update("clips-dev-encryption-key").digest();
}

export function assertAppEncryptionReady(): void {
  resolveEncryptionKey();
}

export function encryptJsonPayload(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveEncryptionKey(), iv);
  const serialized = Buffer.from(JSON.stringify(value), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64")
  });
}

export function decryptJsonPayload<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as {
      iv?: string;
      tag?: string;
      data?: string;
    };
    const iv = Buffer.from(parsed.iv ?? "", "base64");
    const tag = Buffer.from(parsed.tag ?? "", "base64");
    const data = Buffer.from(parsed.data ?? "", "base64");
    const decipher = createDecipheriv("aes-256-gcm", resolveEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}
