import { connectedComponents, distanceTransform, selectComponents, skeletonize } from './morphology';
import {
  histogram,
  newMask,
  normalizeContrast,
  otsu,
  threshold,
  toGray,
  type GrayImage,
  type Mask,
  type RgbaImage,
} from './raster';

export interface Preprocessed {
  gray: GrayImage;
  /** Everything darker than the paper/ink threshold (walls, lines, text). */
  ink: Mask;
  inkThreshold: number;
  /** Distance to nearest non-ink pixel, for every ink pixel. */
  inkDistance: Float32Array;
  /** Coloured areas that were treated as paper (fills, tints, coloured symbols). */
  tint: Mask;
}

/**
 * Grayscale (colour areas as paper) → background flattening when the paper is not clean →
 * contrast normalisation → global (Otsu) ink threshold → distance transform.
 * Kept independent of what the ink represents; later stages decide.
 */
export function preprocessImage(img: RgbaImage): Preprocessed {
  const tint = newMask(img.width, img.height);
  let base = normalisePolarity(suppressColour(img, toGray(img), 45, 70, tint));
  if (paperFraction(base) < 0.5)
    base = flattenBackground(base, Math.max(25, Math.round(0.03 * Math.min(img.width, img.height))));
  const gray = normalizeContrast(base);
  // Otsu separates paper from ink. Clamp: very clean renders have bimodal 0/255 histograms.
  const t = Math.min(200, Math.max(60, otsu(histogram(gray))));
  const ink = threshold(gray, t);
  return { gray, ink, inkThreshold: t, inkDistance: distanceTransform(ink), tint };
}

/**
 * Structure (walls, openings, linework) is drawn in black or grey on almost every plan; colour
 * is used for floor finishes, room tints, furniture shading and coloured annotations. Strongly
 * coloured pixels are therefore treated as paper — unless they are very dark (dark fills still
 * count as ink). Greyscale plans are unaffected.
 */
export function suppressColour(
  img: RgbaImage,
  gray: GrayImage,
  minChroma = 45,
  keepBelow = 70,
  suppressed?: Mask,
): GrayImage {
  const { width: W, height: H } = gray;
  const d = img.data;
  const coloured = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < coloured.length; i++, p += 4) {
    const chroma = Math.max(d[p]!, d[p + 1]!, d[p + 2]!) - Math.min(d[p]!, d[p + 1]!, d[p + 2]!);
    coloured[i] = chroma >= minChroma && gray.data[i]! >= keepBelow ? 1 : 0;
  }
  // Only coloured AREAS: an isolated fringe (anti-aliased text, thin coloured lines) stays.
  const out = new Uint8Array(gray.data);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (coloured[i] && coloured[i - 1] && coloured[i + 1] && coloured[i - W] && coloured[i + W]) {
        out[i] = 255;
        if (suppressed) suppressed.data[i] = 1;
      }
    }
  }
  return { width: W, height: H, data: out };
}

/**
 * Most plans draw dark ink on light paper; some (exports, presentation plans) draw white walls
 * on a grey or dark ground. When the background is not white and the drawing is mostly brighter
 * than it, ink is measured as distance from the background level, in either direction.
 */
export function normalisePolarity(g: GrayImage): GrayImage {
  const h = histogram(g);
  let bg = 0;
  for (let v = 1; v < 256; v++) if (h[v]! > h[bg]!) bg = v;
  if (bg >= 225) return g;
  let brighter = 0;
  let darker = 0;
  for (let v = Math.min(255, bg + 30); v < 256; v++) brighter += h[v]!;
  for (let v = 0; v <= bg - 30; v++) darker += h[v]!;
  // A grey scan or photo still has far more dark ink than bright highlights (lighting, glare):
  // only a drawing whose deviation from the ground is mostly brighter is inverted.
  if (brighter < 0.02 * g.data.length || brighter <= darker) return g;
  const out = new Uint8Array(g.data.length);
  // Scaled so that a wall as far from the ground as the brighter side allows becomes full ink.
  const k = 255 / Math.max(30, Math.min(bg, 255 - bg));
  for (let i = 0; i < out.length; i++)
    out[i] = 255 - Math.min(255, Math.round(Math.abs(g.data[i]! - bg) * k));
  return { width: g.width, height: g.height, data: out };
}

const paperFraction = (g: GrayImage) => {
  let n = 0;
  for (let i = 0; i < g.data.length; i++) if (g.data[i]! >= 225) n++;
  return n / g.data.length;
};

/** Sliding-window maximum along rows or columns (van Herk / Gil–Werman): O(n), any radius. */
function maxFilter1d(src: Uint8Array, W: number, H: number, r: number, horizontal: boolean): Uint8Array {
  const out = new Uint8Array(src.length);
  const n = horizontal ? W : H;
  const lines = horizontal ? H : W;
  const k = 2 * r + 1;
  const g = new Uint8Array(n + k);
  const h = new Uint8Array(n + k);
  const at = (line: number, i: number) => (horizontal ? line * W + i : i * W + line);
  for (let line = 0; line < lines; line++) {
    const v = (i: number) => (i < 0 || i >= n ? 0 : src[at(line, i)]!);
    // Prefix/suffix maxima over blocks of length k, on the line padded by r each side.
    for (let i = 0; i < n + k - 1; i++) g[i] = i % k === 0 ? v(i - r) : Math.max(g[i - 1]!, v(i - r));
    for (let i = n + k - 2; i >= 0; i--)
      h[i] = i % k === k - 1 || i === n + k - 2 ? v(i - r) : Math.max(h[i + 1]!, v(i - r));
    for (let i = 0; i < n; i++) out[at(line, i)] = Math.max(h[i]!, g[i + k - 1]!);
  }
  return out;
}

/**
 * Photographs and tinted scans have uneven, non-white paper. Estimate the paper level with a
 * large maximum filter (ink is thinner than the window) and divide it out, so the paper becomes
 * white and the drawing keeps its contrast. Linear time.
 */
export function flattenBackground(g: GrayImage, radius: number): GrayImage {
  const { width: W, height: H } = g;
  const bg = maxFilter1d(maxFilter1d(g.data, W, H, radius, true), W, H, radius, false);
  const out = new Uint8Array(g.data.length);
  for (let i = 0; i < out.length; i++)
    out[i] = Math.min(255, Math.round((255 * g.data[i]!) / Math.max(1, bg[i]!)));
  return { width: W, height: H, data: out };
}

export interface ThicknessProfile {
  /** Thickness (px) of the thickest common wall class (usually external walls). */
  major: number;
  /** Thickness (px) of the thinnest common wall class (usually partitions). */
  minor: number;
  /** All modes found, ascending. */
  modes: number[];
}

/**
 * Find the plan's wall thickness classes from the stroke widths of its thick ink.
 * Stroke width at a skeleton pixel ≈ 2·EDT − 0.5. Text and thin lines are excluded because
 * the thickest connected network (the walls) dominates the length-weighted histogram.
 */
export function wallThicknessProfile(pre: Preprocessed): ThicknessProfile {
  const { ink, inkDistance } = pre;
  const { labels, components } = connectedComponents(ink);
  // Candidate stroke networks: components with at least one pixel 2.5 px from paper.
  const maxDist = new Float32Array(components.length + 1);
  for (let i = 0; i < labels.length; i++)
    if (labels[i]) maxDist[labels[i]!] = Math.max(maxDist[labels[i]!]!, inkDistance[i]!);
  const keep = new Set(
    components
      .filter((c) => maxDist[c.label]! >= 2.5 && Math.max(c.box.x1 - c.box.x0, c.box.y1 - c.box.y0) >= 20)
      .map((c) => c.label),
  );
  const skel = skeletonize(selectComponents(labels, keep, ink.width, ink.height));
  const hist = new Float64Array(128);
  for (let i = 0; i < skel.data.length; i++) {
    if (!skel.data[i]) continue;
    const t = Math.round(2 * inkDistance[i]! - 0.5);
    if (t >= 3 && t < hist.length) hist[t]!++;
  }
  // Smooth and find local maxima carrying ≥ 8 % of the length above 3 px.
  const smooth = hist.map((_, i) => (hist[i - 1] ?? 0) * 0.25 + hist[i]! * 0.5 + (hist[i + 1] ?? 0) * 0.25);
  const total = smooth.reduce((a, b) => a + b, 0) || 1;
  const modes: number[] = [];
  for (let t = 3; t < smooth.length - 1; t++) {
    const win = smooth[t - 1]! + smooth[t]! + smooth[t + 1]!;
    if (smooth[t]! >= smooth[t - 1]! && smooth[t]! >= smooth[t + 1]! && win / total >= 0.08) {
      if (!modes.length || t - modes[modes.length - 1]! > 2) modes.push(t);
    }
  }
  if (!modes.length) {
    const best = smooth.indexOf(Math.max(...smooth));
    modes.push(Math.max(3, best));
  }
  // Bold text and heavy symbols also form thickness modes. Partitions are rarely thinner than
  // about a third of external walls, so classes below 0.35 × the thickest are not walls.
  const major = modes[modes.length - 1]!;
  const wallModes = modes.filter((m) => m >= 0.35 * major);
  return { major, minor: wallModes[0]!, modes: wallModes };
}
