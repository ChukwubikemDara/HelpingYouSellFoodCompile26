/**
 * Photo upload for listings. putPhoto() stores the image and returns a
 * public URL the API puts in Deal.photo_url.
 *
 * PHOTOS_DRIVER selects the driver (read in lib/config.ts):
 * - "local" (the default outside production; dev and tests): files under PHOTOS_LOCAL_DIR
 *   (default <cwd>/.data/photos), served at /api/photos/<file> by a route
 *   that calls localPhotoResponse(). Logs a warning in production.
 * - "s3" (the default in production): PHOTOS_BUCKET (required), objects under
 *   photos/, public-read through the bucket policy; URL from
 *   PHOTOS_PUBLIC_BASE_URL when set.
 */
import { PHOTOS_DRIVERS, photosDriver, type PhotosDriver } from "@/lib/config";
import { isProduction } from "@/lib/env";
import { createLocalPhotoStore } from "./local";
import { createS3PhotoStore } from "./s3";
import type { PhotoStore } from "./types";

export type { PhotoStore } from "./types";
export {
  PHOTO_LIMITS,
  PHOTO_TYPES,
  decodePhotoBase64,
  detectPhotoType,
  isPhotoContentType,
  type DecodedPhoto,
  type PhotoContentType,
} from "./decode";
export {
  LOCAL_PHOTO_URL_PREFIX,
  createLocalPhotoStore,
  localPhotoDir,
  localPhotoResponse,
  readLocalPhoto,
} from "./local";
export { S3_PHOTO_PREFIX, createS3PhotoStore, getS3Client, s3PublicUrl } from "./s3";

export { PHOTOS_DRIVERS, photosDriver, type PhotosDriver };

const holder = globalThis as typeof globalThis & { __photosLocalWarned?: boolean };

/** The photo store for the current environment. */
export function getPhotoStore(): PhotoStore {
  if (photosDriver() === "s3") {
    const bucket = process.env.PHOTOS_BUCKET?.trim();
    if (!bucket) throw new Error("PHOTOS_BUCKET is required when PHOTOS_DRIVER=s3");
    return createS3PhotoStore({ bucket, publicBaseUrl: process.env.PHOTOS_PUBLIC_BASE_URL?.trim() || undefined });
  }
  if (isProduction() && !holder.__photosLocalWarned) {
    holder.__photosLocalWarned = true;
    console.warn("[photos] PHOTOS_DRIVER=local in production: photos are written to this server's disk. Use PHOTOS_DRIVER=s3.");
  }
  return createLocalPhotoStore();
}

/** Store the image bytes and return a URL anyone can GET. */
export async function putPhoto(bytes: Uint8Array, contentType: string): Promise<string> {
  return getPhotoStore().put(bytes, contentType);
}
