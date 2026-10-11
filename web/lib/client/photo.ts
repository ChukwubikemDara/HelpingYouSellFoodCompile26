/**
 * Client-side photo resize. The contract asks for photos under 1 MB before
 * upload; the portal re-encodes every photo as JPEG, shrinking it until the
 * encoded bytes fit, and sends it as plain base64 (no "data:" prefix).
 */

/** Encoded JPEG bytes must stay under this. Leaves headroom under 1 MB. */
export const MAX_PHOTO_BYTES = 900 * 1024;

const START_MAX_SIDE = 1600;
const MIN_MAX_SIDE = 480;
const QUALITIES = [0.85, 0.75, 0.65, 0.55];

export interface ResizedPhoto {
  /** Base64 of the JPEG bytes, without a data: prefix. */
  base64: string;
  /** data: URL for an on-screen preview. */
  previewUrl: string;
  bytes: number;
}

async function loadImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to <img>, which some browsers decode more formats with.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Resize and re-encode a photo to a JPEG under MAX_PHOTO_BYTES. Throws if the file cannot be read. */
export async function resizePhoto(file: File): Promise<ResizedPhoto> {
  const image = await loadImage(file);
  try {
    if (!image.width || !image.height) throw new Error("empty image");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");

    for (let maxSide = START_MAX_SIDE; maxSide >= MIN_MAX_SIDE; maxSide = Math.floor(maxSide * 0.75)) {
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      // JPEG has no transparency: paint white first.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITIES) {
        const blob = await toJpegBlob(canvas, quality);
        if (blob && blob.size <= MAX_PHOTO_BYTES) {
          const dataUrl = await blobToDataUrl(blob);
          const comma = dataUrl.indexOf(",");
          return { base64: dataUrl.slice(comma + 1), previewUrl: dataUrl, bytes: blob.size };
        }
      }
    }
    throw new Error("could not shrink photo");
  } finally {
    image.close();
  }
}
