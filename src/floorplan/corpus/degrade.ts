import type { AnnotatedDimension, FloorPlanAnnotations, PxPoint } from '../annotationTypes';
import type { RgbaImage } from '../cv/raster';

/**
 * Deterministic image degradations for pathological test fixtures: a clean plan with known
 * ground truth turned into a "scan" or "photo". Geometry-preserving operations keep the truth
 * valid; `scale` changes pixel coordinates, so the truth is scaled with `scaleAnnotations`.
 */
export interface DegradeOps {
  /** Box-blur radius in pixels (applied three times ≈ Gaussian). */
  blur?: number;
  /** Gaussian noise standard deviation (0–255 grey levels). */
  noise?: number;
  /** Salt-and-pepper speck probability per pixel. */
  specks?: number;
  /** Contrast factor (1 = unchanged, 0.5 = washed out). */
  contrast?: number;
  /** Paper grey level (255 = white; e.g. 215 for a greyish scan). */
  paper?: number;
  /** Darkening towards the corners (0–1), like uneven lighting. */
  vignette?: number;
  /** Uniform resize factor (e.g. 0.5). */
  scale?: number;
  seed?: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function resize(img: RgbaImage, k: number): RgbaImage {
  const W = Math.max(1, Math.round(img.width * k));
  const H = Math.max(1, Math.round(img.height * k));
  const out = new Uint8ClampedArray(W * H * 4);
  // Area average when shrinking, nearest-neighbour when enlarging.
  const fx = img.width / W;
  const fy = img.height / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * fx);
      const y0 = Math.floor(y * fy);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const i = (yy * img.width + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c]! += img.data[i + c]!;
          n++;
        }
      }
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c]! / Math.max(1, n));
    }
  }
  return { width: W, height: H, data: out };
}

function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  // (Float32Array<ArrayBuffer> throughout.)
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const pass = (a: Float32Array, b: Float32Array, horizontal: boolean) => {
    const n = horizontal ? W : H;
    const lines = horizontal ? H : W;
    for (let l = 0; l < lines; l++) {
      const at = (i: number) => (horizontal ? l * W + i : i * W + l);
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += a[at(Math.min(n - 1, Math.max(0, i)))]!;
      for (let i = 0; i < n; i++) {
        b[at(i)] = sum / (2 * r + 1);
        sum += a[at(Math.min(n - 1, i + r + 1))]! - a[at(Math.max(0, i - r))]!;
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  return out;
}

export function degradeImage(input: RgbaImage, ops: DegradeOps): RgbaImage {
  const img = ops.scale && ops.scale !== 1 ? resize(input, ops.scale) : input;
  const { width: W, height: H } = img;
  const rand = rng(ops.seed ?? 7);
  const channels = [0, 1, 2].map((c) => {
    let ch: Float32Array = new Float32Array(W * H);
    for (let i = 0; i < ch.length; i++) {
      const a = img.data[i * 4 + 3]! / 255;
      ch[i] = img.data[i * 4 + c]! * a + 255 * (1 - a);
    }
    if (ops.blur) for (let k = 0; k < 3; k++) ch = boxBlur(ch, W, H, Math.max(1, Math.round(ops.blur)));
    return ch;
  });
  const out = new Uint8ClampedArray(W * H * 4);
  const paper = ops.paper ?? 255;
  const contrast = ops.contrast ?? 1;
  const cx = W / 2;
  const cy = H / 2;
  const maxD = Math.hypot(cx, cy);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const y = (i - x) / W;
    const light = 1 - (ops.vignette ?? 0) * (Math.hypot(x - cx, y - cy) / maxD) ** 2;
    let noise = 0;
    if (ops.noise) {
      // Box–Muller.
      const u = Math.max(1e-9, rand());
      noise = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()) * ops.noise;
    }
    const speck = ops.specks && rand() < ops.specks ? (rand() < 0.5 ? -255 : 255) : 0;
    for (let c = 0; c < 3; c++) {
      // Paper tint and contrast: map [0, 255] → [ink, paper], then compress around the middle.
      let v = (channels[c]![i]! / 255) * paper;
      v = paper / 2 + (v - paper / 2) * contrast;
      out[i * 4 + c] = Math.round(v * light + noise + speck);
    }
    out[i * 4 + 3] = 255;
  }
  return { width: W, height: H, data: out };
}

/** Scale every pixel coordinate of an annotation set (for resized fixtures). */
export function scaleAnnotations(ann: FloorPlanAnnotations, k: number): FloorPlanAnnotations {
  const p = (q: PxPoint): PxPoint => ({ x: q.x * k, y: q.y * k });
  const dim = (d: AnnotatedDimension): AnnotatedDimension =>
    'span' in d ? { ...d, span: [d.span[0] * k, d.span[1] * k] } : { ...d, a: p(d.a), b: p(d.b) };
  return {
    ...ann,
    image: {
      ...ann.image,
      widthPx: Math.round(ann.image.widthPx * k),
      heightPx: Math.round(ann.image.heightPx * k),
    },
    originPx: p(ann.originPx),
    footprint: ann.footprint.map(p),
    ...(ann.internalEnvelope ? { internalEnvelope: ann.internalEnvelope.map(p) } : {}),
    ...(ann.compass ? { compass: { center: p(ann.compass.center), northTip: p(ann.compass.northTip) } } : {}),
    ...(ann.calibration
      ? {
          calibration: {
            ...ann.calibration,
            ...(ann.calibration.references ? { references: ann.calibration.references.map(dim) } : {}),
            ...(ann.calibration.manualPixelsPerMeter
              ? { manualPixelsPerMeter: ann.calibration.manualPixelsPerMeter * k }
              : {}),
          },
        }
      : {}),
    walls: ann.walls.map((w) =>
      'rect' in w
        ? { ...w, rect: { x0: w.rect.x0 * k, y0: w.rect.y0 * k, x1: w.rect.x1 * k, y1: w.rect.y1 * k } }
        : { ...w, segment: { a: p(w.segment.a), b: p(w.segment.b), thicknessPx: w.segment.thicknessPx * k } },
    ),
    doors: ann.doors.map((d) => ({ ...d, span: [d.span[0] * k, d.span[1] * k] })),
    windows: ann.windows.map((w) => ({ ...w, span: [w.span[0] * k, w.span[1] * k] })),
    rooms: ann.rooms.map((r) => ({
      ...r,
      polygon: r.polygon.map(p),
      ...(r.dimensions ? { dimensions: r.dimensions.map(dim) } : {}),
    })),
    fixtures: ann.fixtures.map((f) =>
      'rect' in f
        ? { ...f, rect: { x0: f.rect.x0 * k, y0: f.rect.y0 * k, x1: f.rect.x1 * k, y1: f.rect.y1 * k } }
        : { ...f, polygon: f.polygon.map(p) },
    ),
    ...(ann.labels ? { labels: ann.labels.map((l) => ({ ...l, at: p(l.at) })) } : {}),
    drawingNotes: ann.drawingNotes.map((n) =>
      n.rect
        ? { ...n, rect: { x0: n.rect.x0 * k, y0: n.rect.y0 * k, x1: n.rect.x1 * k, y1: n.rect.y1 * k } }
        : n,
    ),
  };
}
