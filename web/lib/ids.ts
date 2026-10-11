import { randomBytes } from "node:crypto";

/**
 * ID prefixes. IDs are strings: "<prefix>_<random>", e.g. "d_Kx3...".
 * The contract only requires strings; the prefix is for humans reading logs.
 */
export const ID_PREFIX = {
  customer: "c",
  merchant: "m",
  merchantAccount: "ma",
  deal: "d",
  reservation: "r",
  notification: "n",
  suggestion: "s",
} as const;
export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

/** A new random id with the given prefix (72 random bits, URL-safe). */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

/** A random opaque secret (session id, bearer token). 256 bits, URL-safe. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}
