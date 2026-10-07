import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { RgbaImage } from './raster';

/** Node-only image decoding for tests and scripts (the browser uses a canvas). */
export function loadImageFile(path: string): RgbaImage {
  const buf = readFileSync(path);
  if (path.toLowerCase().endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  const img = jpeg.decode(buf, { useTArray: true });
  return { width: img.width, height: img.height, data: img.data };
}
