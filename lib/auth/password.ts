import { hash, hashRaw, verify } from "@node-rs/argon2";
import { timingSafeEqual } from "node:crypto";

const ARGON2_MEMORY = 64 * 1024;
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 4;
const ARGON2_TAG_LENGTH = 32;
const ARGON2ID_ALGORITHM = 2;
const ARGON2_V13 = 1;

function baseOptions() {
  return {
    algorithm: ARGON2ID_ALGORITHM,
    version: ARGON2_V13,
    memoryCost: ARGON2_MEMORY,
    timeCost: ARGON2_PASSES,
    parallelism: ARGON2_PARALLELISM,
    outputLen: ARGON2_TAG_LENGTH
  };
}

function isLegacyHash(encoded: string): boolean {
  return encoded.startsWith("argon2id$");
}

async function verifyLegacyHash(password: string, encoded: string): Promise<boolean> {
  const [algorithm, memoryRaw, passesRaw, parallelismRaw, saltBase64, digestBase64] =
    encoded.split("$");
  if (
    algorithm !== "argon2id" ||
    !memoryRaw ||
    !passesRaw ||
    !parallelismRaw ||
    !saltBase64 ||
    !digestBase64
  ) {
    return false;
  }

  const actual = await hashRaw(password.trim(), {
    algorithm: ARGON2ID_ALGORITHM,
    version: ARGON2_V13,
    memoryCost: Number.parseInt(memoryRaw, 10),
    timeCost: Number.parseInt(passesRaw, 10),
    parallelism: Number.parseInt(parallelismRaw, 10),
    outputLen: Buffer.from(digestBase64, "base64").length,
    salt: Buffer.from(saltBase64, "base64")
  });

  const expected = Buffer.from(digestBase64, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function hashPassword(password: string): Promise<string> {
  const normalized = password.trim();
  if (normalized.length < 8) {
    throw new Error("Пароль должен содержать минимум 8 символов.");
  }

  return hash(normalized, baseOptions());
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const normalized = password.trim();
  if (!normalized || !encoded.trim()) {
    return false;
  }

  if (isLegacyHash(encoded)) {
    return verifyLegacyHash(normalized, encoded);
  }

  return verify(encoded, normalized);
}
