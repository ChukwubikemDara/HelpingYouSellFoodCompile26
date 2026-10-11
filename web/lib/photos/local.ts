/**
 * Local photo driver for dev and tests.
 *
 * Files go to PHOTOS_LOCAL_DIR (default <cwd>/.data/photos, gitignored) as
 * "<random>.<ext>". The URL returned is "/api/photos/<file>" on the same
 * origin; a route at app/api/photos/[file]/route.ts serves it with
 * localPhotoResponse(). Not for production: the server's disk is not shared
 * or durable there.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorResponse } from "@/lib/http";
import { PHOTO_TYPES, isPhotoContentType, type PhotoContentType } from "./decode";
import type { PhotoStore } from "./types";

export const LOCAL_PHOTO_URL_PREFIX = "/api/photos";

const FILE_NAME = /^[A-Za-z0-9_-]{8,64}\.(jpg|png|webp|gif)$/;

const TYPE_BY_EXTENSION: Record<string, PhotoContentType> = Object.fromEntries(
  Object.entries(PHOTO_TYPES).map(([type, ext]) => [ext, type as PhotoContentType]),
);

/** PHOTOS_LOCAL_DIR, or <cwd>/.data/photos. */
export function localPhotoDir(): string {
  const configured = process.env.PHOTOS_LOCAL_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".data", "photos");
}

export function photoFileName(contentType: PhotoContentType): string {
  return `${randomBytes(16).toString("base64url")}.${PHOTO_TYPES[contentType]}`;
}

export function createLocalPhotoStore(options: { dir?: string; urlPrefix?: string } = {}): PhotoStore {
  const urlPrefix = options.urlPrefix ?? LOCAL_PHOTO_URL_PREFIX;
  return {
    driver: "local",
    async put(bytes, contentType) {
      if (!isPhotoContentType(contentType)) throw new Error(`Unsupported photo type: ${contentType}`);
      const dir = options.dir ?? localPhotoDir();
      const name = photoFileName(contentType);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, name), bytes);
      return `${urlPrefix}/${name}`;
    },
  };
}

/** The stored file, or null if the name is not one we write or the file does not exist. */
export async function readLocalPhoto(
  fileName: string,
  dir: string = localPhotoDir(),
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: PhotoContentType } | null> {
  const match = FILE_NAME.exec(fileName);
  if (!match) return null;
  try {
    const bytes = await readFile(path.join(dir, fileName));
    return { bytes: new Uint8Array(bytes), contentType: TYPE_BY_EXTENSION[match[1]] };
  } catch {
    return null;
  }
}

/** GET handler body for a local photo: the image, or 404 NOT_FOUND. */
export async function localPhotoResponse(fileName: string, dir?: string): Promise<Response> {
  const photo = await readLocalPhoto(fileName, dir);
  if (!photo) return errorResponse("NOT_FOUND", "Photo not found.");
  return new Response(photo.bytes, {
    status: 200,
    headers: {
      "content-type": photo.contentType,
      "content-length": String(photo.bytes.length),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
