import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { RgbaImage } from './raster';

/** Node-only image decoding for tests and scripts (the browser uses a canvas). */
export function loadImageFile(path: string): RgbaImage {
  const buf = readFileSync(path);
  // Decide by content, not by file name (downloads are often mislabelled).
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { width: img.width, height: img.height, data: img.data };
}
