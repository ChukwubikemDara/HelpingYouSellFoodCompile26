import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as photoRoute from "@/app/api/photos/[file]/route";
import { createLocalPhotoStore } from "@/lib/photos";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "photo-route-"));
  vi.stubEnv("PHOTOS_DRIVER", "local");
  vi.stubEnv("PHOTOS_LOCAL_DIR", dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function get(file: string) {
  return photoRoute.GET(new Request(`http://localhost/api/photos/${file}`), { params: Promise.resolve({ file }) });
}

describe("GET /api/photos/{file}", () => {
  it("serves a photo stored by the local driver, without a session", async () => {
    const url = await createLocalPhotoStore({ dir }).put(JPEG, "image/jpeg");
    const file = url.split("/").pop() as string;
    const res = await get(file);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });

  it("is 404 NOT_FOUND for an unknown or unsafe name", async () => {
    for (const file of ["nope.jpg", "..%2F..%2Fetc%2Fpasswd", "../package.json"]) {
      const res = await get(file);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("NOT_FOUND");
    }
  });

  it("is 404 NOT_FOUND when photos live in S3", async () => {
    const url = await createLocalPhotoStore({ dir }).put(JPEG, "image/jpeg");
    vi.stubEnv("PHOTOS_DRIVER", "s3");
    const res = await get(url.split("/").pop() as string);
    expect(res.status).toBe(404);
  });
});
