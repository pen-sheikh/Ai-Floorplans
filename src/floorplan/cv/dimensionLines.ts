import type { Box, GrayImage, Mask } from './raster';

export interface MeasuredDimensionLine {
  /** End points of the dimensioned distance (tick to tick), image pixels. */
  a: { x: number; y: number };
  b: { x: number; y: number };
  meters: number;
  text: string;
  /** Text confidence × how clearly the line was found. */
  confidence: number;
}

export interface DimensionTextInput {
  meters: number;
  text: string;
  box: Box;
  confidence: number;
}

/**
 * A printed single length ("8.00 m", "4200") usually sits on or beside a thin line with end
 * ticks. Find that line next to the text and measure it, so the value can calibrate the scale.
 * Only horizontal text is handled (rotated text is not read by the page OCR). Lines that are
 * not clearly longer than their text, or that run into wall fill, are not used.
 */
export function measureDimensionLines(
  gray: GrayImage,
  wallMask: Mask,
  lineThreshold: number,
  texts: DimensionTextInput[],
): MeasuredDimensionLine[] {
  const { width: W, height: H } = gray;
  const ink = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && gray.data[y * W + x]! < lineThreshold && !wallMask.data[y * W + x];
  const out: MeasuredDimensionLine[] = [];
  for (const t of texts) {
    const th = t.box.y1 - t.box.y0;
    const tw = t.box.x1 - t.box.x0;
    if (!(th > 0) || tw < th) continue; // vertical or degenerate text box
    const xc = Math.round((t.box.x0 + t.box.x1) / 2);
    let best: { y: number; x0: number; x1: number } | null = null;
    for (let y = Math.floor(t.box.y0 - 1.5 * th); y <= Math.ceil(t.box.y1 + 1.5 * th); y++) {
      if (y < 0 || y >= H) continue;
      // Walk out from the text centre; inside the text's own x-range the line may be hidden
      // by the characters, elsewhere it must be continuous (≤ 1 px breaks).
      const walk = (dir: 1 | -1) => {
        let x = xc;
        let lastInk = ink(x, y) ? x : NaN;
        for (let gap = 0; x >= 0 && x < W; x += dir) {
          if (ink(x, y)) {
            lastInk = x;
            gap = 0;
          } else if (++gap > (x > t.box.x0 - 2 && x < t.box.x1 + 2 ? tw : 1)) break;
        }
        return lastInk;
      };
      const x0 = walk(-1);
      const x1 = walk(1);
      if (Number.isNaN(x0) || Number.isNaN(x1) || x0 >= t.box.x0 || x1 <= t.box.x1) continue;
      if (x1 - x0 < 2 * tw) continue;
      if (!best || x1 - x0 > best.x1 - best.x0) best = { y, x0, x1 };
    }
    if (!best) continue;
    // The run must not be wall: wall fill was excluded, so stopping right at fill is suspicious.
    const touchesWall = (x: number) =>
      [-1, 0, 1].some((dx) => wallMask.data[best!.y * W + Math.min(W - 1, Math.max(0, x + dx))]);
    if (touchesWall(best.x0 - 1) || touchesWall(best.x1 + 1)) continue;
    // End ticks (short marks across the line) fix the measured points; without them the run's
    // own ends are used, with lower confidence.
    const tick = (x0: number, dir: 1 | -1) => {
      for (let dx = 0; dx <= 6; dx++) {
        const x = x0 + dir * dx;
        let n = 0;
        for (let dy = -6; dy <= 6; dy++) if (ink(x, best!.y + dy)) n++;
        if (n >= 7) return x + 0.5;
      }
      return null;
    };
    const ta = tick(best.x0, 1);
    const tb = tick(best.x1, -1);
    const a = ta ?? best.x0;
    const b = tb ?? best.x1 + 1;
    out.push({
      a: { x: a, y: best.y + 0.5 },
      b: { x: b, y: best.y + 0.5 },
      meters: t.meters,
      text: t.text,
      confidence: +(t.confidence * (ta !== null && tb !== null ? 1 : 0.7)).toFixed(3),
    });
  }
  return out;
}
