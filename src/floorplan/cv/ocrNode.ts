import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { TesseractOcrProvider } from './ocrTesseract';
import type { RgbaImage } from './raster';

/** Node (tests/scripts): offline tesseract with the bundled English model and PNG encoding. */
export function nodeOcrProvider(): TesseractOcrProvider {
  const require = createRequire(import.meta.url);
  const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  return new TesseractOcrProvider({
    langPath,
    encode: (img: RgbaImage) => {
      const png = new PNG({ width: img.width, height: img.height });
      png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
      return PNG.sync.write(png);
    },
  });
}
