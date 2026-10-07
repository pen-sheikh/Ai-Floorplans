import type { RgbaImage } from './raster';

/** Largest side processed. Bigger scans are reduced (processing time grows with pixels). */
export const MAX_PLAN_SIDE_PX = 2400;

/**
 * Decode an uploaded image to RGBA pixels in the browser. Returns the pixels and an object URL
 * of exactly that raster (so the 2D view's background matches the annotation coordinates).
 */
export async function decodeImageBlob(
  blob: Blob,
  maxSide = MAX_PLAN_SIDE_PX,
): Promise<{ image: RgbaImage; url: string; scaled: boolean }> {
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * k));
  const height = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot decode images (no 2D canvas).');
  ctx.fillStyle = '#fff'; // transparent PNGs read as paper
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, width, height);
  const url =
    k < 1
      ? URL.createObjectURL(
          await new Promise<Blob>((res, rej) =>
            canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), 'image/png'),
          ),
        )
      : URL.createObjectURL(blob);
  return { image: { width, height, data }, url, scaled: k < 1 };
}
