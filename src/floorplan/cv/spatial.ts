import type { Box } from './raster';

interface Seg {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/**
 * Uniform grid over line segments, so "which walls are near here?" costs time proportional
 * to the answer instead of to every wall in the plan (scanned or detailed plans can produce
 * thousands of candidate segments).
 */
export class SegmentGrid<T extends Seg> {
  private readonly cells = new Map<number, T[]>();

  constructor(
    items: readonly T[],
    private readonly cell: number,
    pad = 0,
  ) {
    for (const it of items) {
      const x0 = Math.floor((Math.min(it.a.x, it.b.x) - pad) / cell);
      const x1 = Math.floor((Math.max(it.a.x, it.b.x) + pad) / cell);
      const y0 = Math.floor((Math.min(it.a.y, it.b.y) - pad) / cell);
      const y1 = Math.floor((Math.max(it.a.y, it.b.y) + pad) / cell);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const k = key(cx, cy);
          const list = this.cells.get(k);
          if (list) list.push(it);
          else this.cells.set(k, [it]);
        }
      }
    }
  }

  /** Items whose (padded) bounding box may intersect the box. */
  query(box: Box): T[] {
    const out = new Set<T>();
    const x0 = Math.floor(box.x0 / this.cell);
    const x1 = Math.floor(box.x1 / this.cell);
    const y0 = Math.floor(box.y0 / this.cell);
    const y1 = Math.floor(box.y1 / this.cell);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) for (const it of this.cells.get(key(cx, cy)) ?? []) out.add(it);
    }
    return [...out];
  }

  near(p: { x: number; y: number }, r: number): T[] {
    return this.query({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });
  }
}

// Cells far outside any image still hash uniquely (coordinates are bounded by image size).
const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);
