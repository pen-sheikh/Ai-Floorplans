import type { Box, RgbaImage } from './raster';
import type { OcrProvider, OcrWord } from './text';

export interface TesseractOptions {
  /** Folder (or URL) containing eng.traineddata(.gz). Bundled locally — never a CDN in production. */
  langPath: string;
  /** Browser only: URLs of the worker script and the wasm core folder. */
  workerPath?: string;
  corePath?: string;
  /** Turns an RGBA image into something tesseract.js accepts (PNG Buffer in Node, ImageData in the browser). */
  encode: (img: RgbaImage) => unknown;
}

/** Crop (and enlarge, nearest-neighbour) part of an image for a second, closer OCR read. */
export function cropScale(img: RgbaImage, region: Box, scale: number): RgbaImage {
  const x0 = Math.max(0, Math.floor(region.x0));
  const y0 = Math.max(0, Math.floor(region.y0));
  const x1 = Math.min(img.width, Math.ceil(region.x1));
  const y1 = Math.min(img.height, Math.ceil(region.y1));
  const w = Math.max(1, (x1 - x0) * scale);
  const h = Math.max(1, (y1 - y0) * scale);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y0 + Math.floor(y / scale)) * img.width + (x0 + Math.floor(x / scale))) * 4;
      const di = (y * w + x) * 4;
      data[di] = img.data[si]!;
      data[di + 1] = img.data[si + 1]!;
      data[di + 2] = img.data[si + 2]!;
      data[di + 3] = img.data[si + 3]!;
    }
  }
  return { width: w, height: h, data };
}

type Worker = {
  recognize: (img: unknown, opts?: object, output?: object) => Promise<{ data: { blocks?: Block[] | null } }>;
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};
type Block = { paragraphs: { lines: { words: { text: string; confidence: number; bbox: Box }[] }[] }[] };

/** Offline OCR with tesseract.js (LSTM English model). The module is loaded lazily. */
export class TesseractOcrProvider implements OcrProvider {
  readonly name = 'tesseract.js';
  private worker: Promise<Worker> | null = null;
  constructor(private readonly opts: TesseractOptions) {}

  private getWorker(): Promise<Worker> {
    this.worker ??= import('tesseract.js').then(async ({ createWorker }) => {
      const w = (await createWorker('eng', 1, {
        langPath: this.opts.langPath,
        gzip: true,
        cacheMethod: 'none',
        ...(this.opts.workerPath ? { workerPath: this.opts.workerPath } : {}),
        ...(this.opts.corePath ? { corePath: this.opts.corePath } : {}),
      })) as unknown as Worker;
      return w;
    });
    return this.worker;
  }

  async recognize(
    image: RgbaImage,
    o: { region?: Box; scale?: number; charWhitelist?: string; singleLine?: boolean } = {},
  ): Promise<OcrWord[]> {
    const worker = await this.getWorker();
    const scale = o.scale ?? 1;
    const src = o.region ? cropScale(image, o.region, scale) : image;
    await worker.setParameters({
      tessedit_char_whitelist: o.charWhitelist ?? '',
      tessedit_pageseg_mode: o.singleLine ? '7' : '11', // 11 = sparse text: plans are not paragraphs
    });
    const { data } = await worker.recognize(this.opts.encode(src), {}, { blocks: true });
    const ox = o.region ? Math.max(0, Math.floor(o.region.x0)) : 0;
    const oy = o.region ? Math.max(0, Math.floor(o.region.y0)) : 0;
    return (data.blocks ?? []).flatMap((b) =>
      b.paragraphs.flatMap((p) =>
        p.lines.flatMap((l) =>
          l.words
            .filter((w) => w.text.trim())
            .map((w) => ({
              text: w.text,
              confidence: w.confidence / 100,
              box: {
                x0: ox + w.bbox.x0 / scale,
                y0: oy + w.bbox.y0 / scale,
                x1: ox + w.bbox.x1 / scale,
                y1: oy + w.bbox.y1 / scale,
              },
            })),
        ),
      ),
    );
  }

  async dispose(): Promise<void> {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}
