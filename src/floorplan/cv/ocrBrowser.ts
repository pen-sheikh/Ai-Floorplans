import { TesseractOcrProvider } from './ocrTesseract';

/**
 * In-browser OCR. Worker, WASM core and language data are served by this app from /ocr
 * (copied there at build time), so reading a plan needs no network service and no key.
 */
export function browserOcrProvider(
  base = new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href,
): TesseractOcrProvider {
  return new TesseractOcrProvider({
    langPath: base.replace(/\/$/, ''),
    workerPath: `${base}worker.min.js`,
    corePath: base.replace(/\/$/, ''),
    // tesseract.js reads canvases (not ImageData) in the browser.
    encode: (img) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas
        .getContext('2d')!
        .putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
      return canvas;
    },
  });
}
