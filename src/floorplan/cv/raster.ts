/**
 * Minimal raster primitives for floor-plan image analysis. Pure TypeScript (runs in the
 * browser and in Node tests), row-major, one byte per pixel.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array | Uint8ClampedArray;
}

/** 8-bit luminance, 0 = black. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 0/1 mask. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Box {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

export const newMask = (width: number, height: number): Mask => ({
  width,
  height,
  data: new Uint8Array(width * height),
});

export function toGray(img: RgbaImage): GrayImage {
  const out = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // Composite over white so transparent PNG regions read as paper.
    const a = d[p + 3]! / 255;
    const l = 0.299 * d[p]! + 0.587 * d[p + 1]! + 0.114 * d[p + 2]!;
    out[i] = Math.round(l * a + 255 * (1 - a));
  }
  return { width: img.width, height: img.height, data: out };
}

/** Grey-level histogram. */
export function histogram(g: GrayImage): Uint32Array {
  const h = new Uint32Array(256);
  for (let i = 0; i < g.data.length; i++) h[g.data[i]!]!++;
  return h;
}

/** Linear stretch so the 0.5th/99.5th percentiles map to 0/255 (scan contrast normalisation). */
export function normalizeContrast(g: GrayImage, lowPct = 0.005, highPct = 0.995): GrayImage {
  const h = histogram(g);
  const n = g.data.length;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += h[v]!;
    if (acc >= n * lowPct) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += h[v]!;
    if (acc >= n * (1 - highPct)) {
      hi = v;
      break;
    }
  }
  if (hi - lo < 16) return g;
  const out = new Uint8Array(n);
  const k = 255 / (hi - lo);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round((g.data[i]! - lo) * k)));
  return { width: g.width, height: g.height, data: out };
}

/** Otsu's threshold over a histogram (optionally restricted to [from, to]). */
export function otsu(h: Uint32Array, from = 0, to = 255): number {
  let total = 0;
  let sum = 0;
  for (let v = from; v <= to; v++) {
    total += h[v]!;
    sum += v * h[v]!;
  }
  let sumB = 0;
  let wB = 0;
  let best = from;
  let bestVar = -1;
  for (let v = from; v <= to; v++) {
    wB += h[v]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * h[v]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = v;
    }
  }
  return best;
}

export function threshold(g: GrayImage, below: number): Mask {
  const m = newMask(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) m.data[i] = g.data[i]! < below ? 1 : 0;
  return m;
}

export const inside = (m: { width: number; height: number }, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < m.width && y < m.height;

/** Grey value with bounds check (outside = paper). */
export function grayAt(g: GrayImage, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  return inside(g, xi, yi) ? g.data[yi * g.width + xi]! : 255;
}

export function maskAt(m: Mask, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  return inside(m, xi, yi) ? m.data[yi * m.width + xi]! : 0;
}

export function countMask(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i]!;
  return n;
}

/** Fill a convex polygon (pixel centres inside are set). */
export function fillConvexPolygon(m: Mask, pts: readonly { x: number; y: number }[], value = 1): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(m.height - 1, Math.floor(maxY - 0.5));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    let xl = Infinity;
    let xr = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
        const x = a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x);
        xl = Math.min(xl, x);
        xr = Math.max(xr, x);
      }
    }
    if (xl > xr) continue;
    const xs = Math.max(0, Math.ceil(xl - 0.5));
    const xe = Math.min(m.width - 1, Math.floor(xr - 0.5));
    for (let x = xs; x <= xe; x++) m.data[y * m.width + x] = value;
  }
}

/** Fill any simple polygon (concave allowed) with the even–odd rule at pixel centres. */
export function fillPolygon(m: Mask, pts: readonly { x: number; y: number }[], value = 1): void {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(m.height - 1, Math.floor(maxY - 0.5));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy))
        xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const xb = Math.min(m.width - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = xa; x <= xb; x++) m.data[y * m.width + x] = value;
    }
  }
}
