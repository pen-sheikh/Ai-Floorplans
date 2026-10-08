import type { DocumentCheck } from '../extraction';
import { connectedComponents } from './morphology';
import type { Preprocessed } from './preprocess';

export interface DocumentFeatures {
  /** Share of the image that is ink. Plans: a few % to ~30 %. */
  inkFraction: number;
  /** Share of the ink lying on long straight runs (horizontal, vertical or diagonal). */
  straightFraction: number;
  /** Share of the image that is clean paper (near white). */
  paperFraction: number;
  /** Share of the ink in specks of a few pixels (texture, grain, heavy noise). */
  speckFraction: number;
}

/**
 * "Is this probably a floor plan?" from cheap, general image statistics — linear in pixels.
 * Floor plans are mostly paper, with a moderate amount of ink of which much forms long
 * straight lines; noise, photographs and textures fail one or more of these. The answer is a
 * likelihood with its evidence, never a certainty.
 */
export function measureDocument(pre: Preprocessed): DocumentFeatures {
  const { ink, gray } = pre;
  const W = ink.width;
  const H = ink.height;
  const N = W * H;
  // Paper level: the most common bright grey (photos and scans are not pure white).
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) hist[gray.data[i]!]!++;
  let paperLevel = 255;
  for (let v = 128; v < 256; v++) if (hist[v]! > hist[paperLevel]!) paperLevel = v;
  let inkCount = 0;
  let paper = 0;
  for (let i = 0; i < N; i++) {
    inkCount += ink.data[i]!;
    if (gray.data[i]! >= paperLevel - 35) paper++;
  }
  const minRun = Math.max(20, Math.round(0.02 * Math.min(W, H)));
  const onLine = new Uint8Array(N);
  // Runs along the four principal directions; an ink pixel on any long run counts once.
  const scan = (starts: [number, number][], dx: number, dy: number) => {
    for (const [sx, sy] of starts) {
      let x = sx;
      let y = sy;
      let run: number[] = [];
      const flush = () => {
        if (run.length >= minRun) for (const i of run) onLine[i] = 1;
        run = [];
      };
      while (x >= 0 && y >= 0 && x < W && y < H) {
        const i = y * W + x;
        if (ink.data[i]) run.push(i);
        else flush();
        x += dx;
        y += dy;
      }
      flush();
    }
  };
  const rows = Array.from({ length: H }, (_, y) => [0, y] as [number, number]);
  const cols = Array.from({ length: W }, (_, x) => [x, 0] as [number, number]);
  scan(rows, 1, 0);
  scan(cols, 0, 1);
  scan([...cols, ...rows.slice(1)], 1, 1);
  scan([...cols, ...rows.slice(1).map(([, y]) => [W - 1, y] as [number, number])], -1, 1);
  let straight = 0;
  for (let i = 0; i < N; i++) straight += onLine[i]!;
  // Specks by ink mass: scan noise adds many tiny marks but little ink; texture adds a lot.
  const { components } = connectedComponents(ink);
  const speckMass = components.filter((c) => c.area <= 4).reduce((s, c) => s + c.area, 0);
  return {
    inkFraction: inkCount / N,
    straightFraction: inkCount ? straight / inkCount : 0,
    paperFraction: paper / N,
    speckFraction: inkCount ? speckMass / inkCount : 0,
  };
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
/** 1 inside [lo, hi], falling linearly to 0 at lo − soft and hi + soft. */
const band = (v: number, lo: number, hi: number, soft: number) =>
  clamp(v < lo ? 1 - (lo - v) / soft : v > hi ? 1 - (v - hi) / soft : 1);

export function assessDocument(f: DocumentFeatures): DocumentCheck {
  const evidence: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const inkScore = band(f.inkFraction, 0.01, 0.3, 0.15);
  const straightScore = clamp((f.straightFraction - 0.08) / 0.3);
  const paperScore = clamp((f.paperFraction - 0.25) / 0.35);
  const speckScore = clamp(1 - (f.speckFraction - 0.15) / 0.3);
  if (inkScore < 0.6) evidence.push(`ink covers ${pct(f.inkFraction)} of the image (plans: about 1–30 %)`);
  if (straightScore < 0.6)
    evidence.push(`only ${pct(f.straightFraction)} of the ink forms long straight lines`);
  if (paperScore < 0.6)
    evidence.push(
      `only ${pct(f.paperFraction)} of the image is plain paper (a photograph, texture or dark scan?)`,
    );
  if (speckScore < 0.6)
    evidence.push(`${pct(f.speckFraction)} of the ink is specks (noise, grain or texture)`);
  // Geometric mean: one strong contrary sign is enough to doubt; never certain either way.
  const raw = Math.pow(inkScore * straightScore * paperScore * speckScore, 1 / 4);
  const confidence = +clamp(0.03 + 0.94 * raw, 0.03, 0.97).toFixed(3);
  if (!evidence.length)
    evidence.push(
      `${pct(f.straightFraction)} of the ink is straight linework on a ${pct(f.paperFraction)} paper background`,
    );
  return {
    verdict:
      confidence >= 0.6 ? 'LIKELY_FLOOR_PLAN' : confidence >= 0.3 ? 'UNCERTAIN' : 'UNLIKELY_FLOOR_PLAN',
    confidence,
    evidence,
  };
}
