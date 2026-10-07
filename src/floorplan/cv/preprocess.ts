import { connectedComponents, distanceTransform, selectComponents, skeletonize } from './morphology';
import {
  histogram,
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
}

/**
 * Grayscale → contrast normalisation → global (Otsu) ink threshold → distance transform.
 * Kept independent of what the ink represents; later stages decide.
 */
export function preprocessImage(img: RgbaImage): Preprocessed {
  const gray = normalizeContrast(toGray(img));
  // Otsu separates paper from ink. Clamp: very clean renders have bimodal 0/255 histograms.
  const t = Math.min(200, Math.max(60, otsu(histogram(gray))));
  const ink = threshold(gray, t);
  return { gray, ink, inkThreshold: t, inkDistance: distanceTransform(ink) };
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
