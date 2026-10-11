/**
 * S3 photo driver.
 *
 * PutObject to PHOTOS_BUCKET under "photos/<random>.<ext>". Objects are
 * public-read through the bucket policy (the driver sends no ACL, so it works
 * with ACLs disabled, the S3 default). The returned URL is
 * "<PHOTOS_PUBLIC_BASE_URL>/photos/<file>" when that is set (e.g. a CloudFront
 * domain in front of the bucket), else the bucket's virtual-hosted URL
 * "https://<bucket>.s3.<region>.amazonaws.com/photos/<file>".
 *
 * Credentials come from the SDK default chain (the Amplify compute role in
 * production). Region: APP_AWS_REGION, then AWS_REGION, then the SDK chain.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsRegion } from "@/lib/env";
import { isPhotoContentType } from "./decode";
import { photoFileName } from "./local";
import type { PhotoStore } from "./types";

export const S3_PHOTO_PREFIX = "photos/";

/** Anything with the client's send(); lets tests replace the network call. */
export interface PutObjectSender {
  send(command: PutObjectCommand): Promise<unknown>;
}

export interface S3PhotoStoreOptions {
  bucket: string;
  /** Base URL that maps to the bucket root. No trailing slash needed. */
  publicBaseUrl?: string;
  /** Region for the default URL. Default: APP_AWS_REGION / AWS_REGION, then the client's resolved region. */
  region?: string;
  client?: PutObjectSender & { config?: { region?: unknown } };
}

const holder = globalThis as typeof globalThis & { __photosS3Clients?: Map<string, S3Client> };

export function getS3Client(region: string | undefined = awsRegion()): S3Client {
  holder.__photosS3Clients ??= new Map();
  const key = region ?? "";
  let client = holder.__photosS3Clients.get(key);
  if (!client) {
    client = new S3Client({ region });
    holder.__photosS3Clients.set(key, client);
  }
  return client;
}

async function resolveRegion(options: S3PhotoStoreOptions, client: S3PhotoStoreOptions["client"]): Promise<string> {
  if (options.region) return options.region;
  const fromEnv = awsRegion();
  if (fromEnv) return fromEnv;
  const provider = client?.config?.region;
  if (typeof provider === "function") {
    const value: unknown = await (provider as () => Promise<unknown>)();
    if (typeof value === "string" && value !== "") return value;
  }
  if (typeof provider === "string" && provider !== "") return provider;
  throw new Error("No AWS region for the photo URL. Set APP_AWS_REGION or PHOTOS_PUBLIC_BASE_URL.");
}

/** The public URL of an object key. */
export function s3PublicUrl(key: string, bucket: string, region: string, publicBaseUrl?: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  if (publicBaseUrl) return `${publicBaseUrl.replace(/\/+$/, "")}/${encodedKey}`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

export function createS3PhotoStore(options: S3PhotoStoreOptions): PhotoStore {
  const client = options.client ?? getS3Client(options.region ?? awsRegion());
  return {
    driver: "s3",
    async put(bytes, contentType) {
      if (!isPhotoContentType(contentType)) throw new Error(`Unsupported photo type: ${contentType}`);
      const key = `${S3_PHOTO_PREFIX}${photoFileName(contentType)}`;
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          ContentLength: bytes.length,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      const publicBaseUrl = options.publicBaseUrl?.trim() || undefined;
      const region = publicBaseUrl ? "" : await resolveRegion(options, client);
      return s3PublicUrl(key, options.bucket, region, publicBaseUrl);
    },
  };
}
