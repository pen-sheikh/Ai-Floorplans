import { connectedComponents, type Component } from './morphology';
import { newMask, type Box, type Mask, type RgbaImage } from './raster';

export interface TextRegionOptions {
  /** Character height range in pixels. */
  minCharPx?: number;
  maxCharPx?: number;
}

export interface TextProposals {
  lines: Box[];
  /** Pixels of the glyphs that make up the proposed lines (everything else is drawing). */
  glyphs: Mask;
}

/**
 * Propose horizontal text lines from the drawing itself: small ink blobs that are not wall
 * fill, chained left to right when they share a baseline band and sit a letter-gap apart.
 * Whole-page OCR sometimes treats a region enclosed by heavy walls as one picture and returns
 * nothing (or one junk "word") for it; reading each proposed line on its own avoids that.
 * Linear in the number of ink pixels plus a sort of the blobs.
 */
export function proposeTextLines(ink: Mask, wallMask: Mask, opts: TextRegionOptions = {}): TextProposals {
  const minH = opts.minCharPx ?? 5;
  const maxH = opts.maxCharPx ?? 40;
  const { width: W, height: H } = ink;
  const free = newMask(W, H);
  for (let i = 0; i < free.data.length; i++) free.data[i] = ink.data[i]! && !wallMask.data[i] ? 1 : 0;
  const { labels, components } = connectedComponents(free);
  const h = (c: Component) => c.box.y1 - c.box.y0;
  const w = (c: Component) => c.box.x1 - c.box.x0;
  // Characters: a glyph's height is in range and it is not a long thin stroke (lines, arcs).
  const chars = components
    .filter(
      (c) =>
        h(c) >= minH && h(c) <= maxH && w(c) <= 6 * maxH && c.area >= 6 && c.area / (w(c) * h(c)) >= 0.08,
    )
    .sort((p, q) => p.box.x0 - q.box.x0);

  const parent = chars.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < chars.length; i++) {
    const a = chars[i]!;
    for (let j = i + 1; j < chars.length; j++) {
      const b = chars[j]!;
      const hMax = Math.max(h(a), h(b));
      if (b.box.x0 - a.box.x1 > 0.9 * hMax) {
        if (b.box.x0 - a.box.x1 > 0.9 * maxH) break; // sorted by x0: nothing further can join
        continue;
      }
      const overlap = Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0);
      // Same line: strong vertical overlap and similar glyph heights (punctuation excepted).
      if (overlap < 0.5 * Math.min(h(a), h(b))) continue;
      if (h(a) > 2.5 * h(b) || h(b) > 2.5 * h(a)) continue;
      parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Component[]>();
  chars.forEach((c, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), c]));

  const lines: Box[] = [];
  const cores: Box[] = [];
  for (const g of groups.values()) {
    const box = {
      x0: Math.min(...g.map((c) => c.box.x0)),
      y0: Math.min(...g.map((c) => c.box.y0)),
      x1: Math.max(...g.map((c) => c.box.x1)),
      y1: Math.max(...g.map((c) => c.box.y1)),
    };
    const bh = box.y1 - box.y0;
    // At least two glyphs side by side (a lone blob is a symbol, not a word).
    if (g.length < 2 && box.x1 - box.x0 < 1.5 * bh) continue;
    if (box.x1 - box.x0 < bh) continue;
    cores.push(box);
    const pad = Math.ceil(0.35 * bh);
    lines.push({
      x0: Math.max(0, box.x0 - pad),
      y0: Math.max(0, box.y0 - pad),
      x1: Math.min(W, box.x1 + pad),
      y1: Math.min(H, box.y1 + pad),
    });
  }
  // Glyph pixels: every non-wall blob inside a line, including the small parts the character
  // filter skipped (i-dots, decimal points, serifs).
  const keep = new Set<number>();
  for (const c of components) {
    if (h(c) > maxH) continue;
    const fits = (b: Box) => {
      const mx = 0.6 * (b.y1 - b.y0);
      const my = 0.35 * (b.y1 - b.y0);
      return c.box.x0 >= b.x0 - mx && c.box.x1 <= b.x1 + mx && c.box.y0 >= b.y0 - my && c.box.y1 <= b.y1 + my;
    };
    if (cores.some(fits)) keep.add(c.label);
  }
  const glyphs = newMask(W, H);
  for (let i = 0; i < labels.length; i++) if (keep.has(labels[i]!)) glyphs.data[i] = 1;
  return { lines: lines.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0), glyphs };
}

/**
 * The image with everything except the proposed glyphs (and their anti-aliased edges) painted
 * white, so a line read is not disturbed by dimension lines, door arcs or walls next to it.
 */
export function textOnlyImage(img: RgbaImage, glyphs: Mask): RgbaImage {
  const { width: W, height: H } = img;
  const data = new Uint8ClampedArray(img.data.length).fill(255);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1 && !near; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          near = xx >= 0 && yy >= 0 && xx < W && yy < H && glyphs.data[yy * W + xx] === 1;
        }
      }
      if (!near) continue;
      const i = (y * W + x) * 4;
      data[i] = img.data[i]!;
      data[i + 1] = img.data[i + 1]!;
      data[i + 2] = img.data[i + 2]!;
      data[i + 3] = img.data[i + 3]!;
    }
  }
  return { width: W, height: H, data };
}
