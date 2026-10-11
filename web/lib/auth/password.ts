/**
 * Password hashing with node:crypto scrypt. No external dependency.
 *
 * Stored format (self-describing, so parameters can change later):
 *   scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
 * Each hash has its own random 16-byte salt. Comparison is constant time.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const SCHEME = "scrypt";
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/** A self-describing password hash (algorithm, parameters, salt, hash). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return [SCHEME, N, R, P, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

/** true if `password` matches `storedHash`. Constant-time comparison; false for a malformed hash. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length === 0 || expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = await scryptAsync(password, salt, expected.length, { N: n, r, p, maxmem: 256 * n * r });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * A hash of a random password, computed once. Sign-in for an unknown email or
 * phone verifies against it, so a miss takes as long as a wrong password.
 */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

/** SHA-256 (base64url) of a secret. Session and token records are stored under this, never the raw value. */
export function secretLookupKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("base64url");
}
