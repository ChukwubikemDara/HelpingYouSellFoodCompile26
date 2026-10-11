import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PutObjectCommand } from "@aws-sdk/client-s3";
import { ApiError } from "@/lib/http";
import {
  PHOTO_LIMITS,
  createLocalPhotoStore,
  createS3PhotoStore,
  decodePhotoBase64,
  detectPhotoType,
  getPhotoStore,
  localPhotoResponse,
  photosDriver,
  putPhoto,
  readLocalPhoto,
  s3PublicUrl,
} from "@/lib/photos";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const GIF = new Uint8Array([...Buffer.from("GIF89a"), 0x01, 0x00]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0x24, 0x00, 0x00, 0x00, ...Buffer.from("WEBPVP8 ")]);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function validation(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("VALIDATION");
    expect((error as ApiError).status).toBe(422);
    return error as ApiError;
  }
  throw new Error("expected a VALIDATION error");
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "photos-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("detectPhotoType", () => {
  it("knows JPEG, PNG, GIF and WebP by their first bytes", () => {
    expect(detectPhotoType(JPEG)).toBe("image/jpeg");
    expect(detectPhotoType(PNG)).toBe("image/png");
    expect(detectPhotoType(GIF)).toBe("image/gif");
    expect(detectPhotoType(WEBP)).toBe("image/webp");
    expect(detectPhotoType(new Uint8Array(Buffer.from("hello world")))).toBeNull();
    expect(detectPhotoType(new Uint8Array())).toBeNull();
  });
});

describe("decodePhotoBase64", () => {
  it("decodes plain base64, a data URL, base64url and wrapped lines", () => {
    expect(decodePhotoBase64(b64(JPEG))).toEqual({ bytes: JPEG, contentType: "image/jpeg" });
    expect(decodePhotoBase64(`data:image/png;base64,${b64(PNG)}`)?.contentType).toBe("image/png");
    expect(decodePhotoBase64(Buffer.from(WEBP).toString("base64url"))?.contentType).toBe("image/webp");
    const wrapped = b64(JPEG).replace(/(.{4})/g, "$1\n");
    expect(decodePhotoBase64(wrapped)?.bytes).toEqual(JPEG);
  });

  it("an empty string is no photo", () => {
    expect(decodePhotoBase64("")).toBeNull();
    expect(decodePhotoBase64("   ")).toBeNull();
  });

  it("rejects what is not base64", () => {
    validation(() => decodePhotoBase64("not base64 at all!"));
  });

  it("rejects photos over the size limit", () => {
    const big = new Uint8Array(PHOTO_LIMITS.maxBytes + 1);
    big.set(JPEG);
    const error = validation(() => decodePhotoBase64(b64(big)));
    expect(error.message).toContain("too large");
    const atLimit = new Uint8Array(PHOTO_LIMITS.maxBytes);
    atLimit.set(JPEG);
    expect(decodePhotoBase64(b64(atLimit))?.bytes.length).toBe(PHOTO_LIMITS.maxBytes);
  });

  it("rejects files that are not JPEG, PNG, WebP or GIF", () => {
    validation(() => decodePhotoBase64(b64(new Uint8Array(Buffer.from("%PDF-1.7 ...")))));
  });
});

describe("local driver", () => {
  it("writes the file and returns /api/photos/<file>", async () => {
    const store = createLocalPhotoStore({ dir });
    const url = await store.put(JPEG, "image/jpeg");
    expect(url).toMatch(/^\/api\/photos\/[A-Za-z0-9_-]{22}\.jpg$/);
    const name = url.split("/").pop() as string;
    expect(await readdir(dir)).toContain(name);
    expect(await readLocalPhoto(name, dir)).toEqual({ bytes: JPEG, contentType: "image/jpeg" });
  });

  it("serves a stored photo with its type and a long cache", async () => {
    const url = await createLocalPhotoStore({ dir }).put(PNG, "image/png");
    const response = await localPhotoResponse(url.split("/").pop() as string, dir);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("404 for unknown names and anything that is not a stored file name", async () => {
    for (const name of ["missingmissingmissing.jpg", "../../etc/passwd", "..%2Fsecret.jpg", "a.jpg", "abcdefgh.exe"]) {
      const response = await localPhotoResponse(name, dir);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Photo not found." } });
    }
  });

  it("refuses unsupported content types", async () => {
    await expect(createLocalPhotoStore({ dir }).put(JPEG, "text/plain")).rejects.toThrow();
  });

  it("putPhoto() uses PHOTOS_LOCAL_DIR", async () => {
    vi.stubEnv("PHOTOS_DRIVER", "local");
    vi.stubEnv("PHOTOS_LOCAL_DIR", dir);
    const url = await putPhoto(GIF, "image/gif");
    expect(url).toMatch(/\.gif$/);
    expect(await readdir(dir)).toContain(url.split("/").pop());
  });
});

describe("s3 driver", () => {
  function fakeClient(region?: string) {
    const sent: PutObjectCommand[] = [];
    return {
      sent,
      client: {
        async send(command: PutObjectCommand) {
          sent.push(command);
          return {};
        },
        config: { region: async () => region },
      },
    };
  }

  it("puts the object under photos/ with its type and returns the public base URL", async () => {
    const { client, sent } = fakeClient();
    const store = createS3PhotoStore({ bucket: "app-photos", publicBaseUrl: "https://cdn.example.com/", client });
    const url = await store.put(JPEG, "image/jpeg");
    expect(sent).toHaveLength(1);
    const input = sent[0].input;
    expect(input.Bucket).toBe("app-photos");
    expect(input.Key).toMatch(/^photos\/[A-Za-z0-9_-]{22}\.jpg$/);
    expect(input.ContentType).toBe("image/jpeg");
    expect(input.Body).toBe(JPEG);
    expect(input.ACL).toBeUndefined();
    expect(url).toBe(`https://cdn.example.com/${input.Key}`);
  });

  it("without a base URL, the bucket's virtual-hosted URL in the configured region", async () => {
    vi.stubEnv("APP_AWS_REGION", "us-east-2");
    const { client, sent } = fakeClient("eu-west-1");
    const url = await createS3PhotoStore({ bucket: "app-photos", client }).put(PNG, "image/png");
    expect(url).toBe(`https://app-photos.s3.us-east-2.amazonaws.com/${sent[0].input.Key}`);
  });

  it("falls back to the client's resolved region", async () => {
    vi.stubEnv("APP_AWS_REGION", "");
    vi.stubEnv("AWS_REGION", "");
    const { client, sent } = fakeClient("eu-west-1");
    const url = await createS3PhotoStore({ bucket: "b", client }).put(PNG, "image/png");
    expect(url).toBe(`https://b.s3.eu-west-1.amazonaws.com/${sent[0].input.Key}`);
  });

  it("s3PublicUrl encodes key segments", () => {
    expect(s3PublicUrl("photos/a b.jpg", "b", "us-east-1")).toBe("https://b.s3.us-east-1.amazonaws.com/photos/a%20b.jpg");
  });
});

describe("driver selection", () => {
  it("local by default, s3 when asked, error otherwise", () => {
    vi.stubEnv("PHOTOS_DRIVER", "");
    expect(photosDriver()).toBe("local");
    vi.stubEnv("PHOTOS_DRIVER", "S3");
    expect(photosDriver()).toBe("s3");
    vi.stubEnv("PHOTOS_DRIVER", "gcs");
    expect(() => photosDriver()).toThrow(/PHOTOS_DRIVER/);
  });

  it("s3 needs PHOTOS_BUCKET", () => {
    vi.stubEnv("PHOTOS_DRIVER", "s3");
    vi.stubEnv("PHOTOS_BUCKET", "");
    expect(() => getPhotoStore()).toThrow(/PHOTOS_BUCKET/);
    vi.stubEnv("PHOTOS_BUCKET", "app-photos");
    vi.stubEnv("APP_AWS_REGION", "us-east-1");
    expect(getPhotoStore().driver).toBe("s3");
  });
});
