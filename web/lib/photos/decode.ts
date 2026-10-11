/**
 * Turning the API's photo_base64 into checked image bytes.
 */
import { ApiError } from "@/lib/http";

export const PHOTO_LIMITS = {
  /**
   * Largest decoded photo accepted. Clients resize to under 1 MB (contract);
   * this leaves room for clients that overshoot and stays under Bedrock's
   * 3.75 MB image limit.
   */
  maxBytes: 2 * 1024 * 1024,
} as const;

/** Image types we accept, with the file extension used for storage. */
export const PHOTO_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;
export type PhotoContentType = keyof typeof PHOTO_TYPES;

export function isPhotoContentType(value: string): value is PhotoContentType {
  return Object.prototype.hasOwnProperty.call(PHOTO_TYPES, value);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The image type from the file's first bytes, or null if it is not a JPEG, PNG, WebP or GIF. */
export function detectPhotoType(bytes: Uint8Array): PhotoContentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

export interface DecodedPhoto {
  bytes: Uint8Array;
  contentType: PhotoContentType;
}

const DATA_URL_PREFIX = /^data:[^,]*?;base64,/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_URL = /^[A-Za-z0-9_-]*={0,2}$/;

/**
 * Decode photo_base64 (plain base64, base64url, or a "data:...;base64," URL).
 * Returns null for an empty string (no photo). Throws 422 VALIDATION when it
 * is not base64, too large, or not a JPEG, PNG, WebP or GIF image.
 */
export function decodePhotoBase64(value: string): DecodedPhoto | null {
  const compact = value.replace(DATA_URL_PREFIX, "").replace(/\s+/g, "");
  if (compact === "") return null;
  if (!BASE64.test(compact) && !BASE64_URL.test(compact)) {
    throw new ApiError("VALIDATION", "photo_base64: The photo could not be read. Try another photo.");
  }
  // Check the size before decoding so an oversized body costs nothing more.
  const estimated = Math.floor((compact.length * 3) / 4);
  if (estimated - 2 > PHOTO_LIMITS.maxBytes) {
    throw new ApiError("VALIDATION", "photo_base64: The photo is too large. Use a photo under 1 MB.");
  }
  const bytes = new Uint8Array(Buffer.from(compact, BASE64.test(compact) ? "base64" : "base64url"));
  if (bytes.length === 0) {
    throw new ApiError("VALIDATION", "photo_base64: The photo could not be read. Try another photo.");
  }
  if (bytes.length > PHOTO_LIMITS.maxBytes) {
    throw new ApiError("VALIDATION", "photo_base64: The photo is too large. Use a photo under 1 MB.");
  }
  const contentType = detectPhotoType(bytes);
  if (!contentType) {
    throw new ApiError("VALIDATION", "photo_base64: Send the photo as a JPEG, PNG, WebP or GIF image.");
  }
  return { bytes, contentType };
}
