/**
 * GET /api/photos/{file}: photos stored by the local photo driver
 * (PHOTOS_DRIVER=local, dev and tests). Public, no session: photo_url is shown
 * to customers. With PHOTOS_DRIVER=s3 photos are served by S3 (or the CDN in
 * PHOTOS_PUBLIC_BASE_URL) and this route answers 404.
 */
import { ApiError, handle } from "@/lib/http";
import { localPhotoResponse, photosDriver } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (_request: Request, ctx: { params: Promise<{ file: string }> }) => {
  if (photosDriver() !== "local") throw new ApiError("NOT_FOUND", "Photo not found.");
  const { file } = await ctx.params;
  return localPhotoResponse(file);
});

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
