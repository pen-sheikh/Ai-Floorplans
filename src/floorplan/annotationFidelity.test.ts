import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { PACKENHAM_HOUSE_E2 as ANN } from './annotations/packenhamHouseE2';
import type { PxRect } from './annotationTypes';
import { wallAxis } from './reconstruct';

/**
 * Checks the hand annotation against the actual pixels of floor-plans/E2-floorplan.jpg, so
 * the model cannot silently drift from the plan: walls must sit on dark (wall-fill) pixels,
 * openings must be gaps, and room interiors must be light.
 */
const img = jpeg.decode(readFileSync(resolve(__dirname, '../../', ANN.image.file)), { useTArray: true });
const luma = (x: number, y: number) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
};
const DARK = 100;

function darkFraction(r: PxRect, inset = 2): number {
  let dark = 0;
  let total = 0;
  for (let x = r.x0 + inset; x < r.x1 - inset; x++) {
    for (let y = r.y0 + inset; y < r.y1 - inset; y++) {
      total++;
      if (luma(x, y) < DARK) dark++;
    }
  }
  return total ? dark / total : 1;
}

/** Wall rect restricted to [from, to) along its long axis. */
function spanRect(r: PxRect, from: number, to: number): PxRect {
  return wallAxis(r).axis === 'x' ? { ...r, x0: from, x1: to } : { ...r, y0: from, y1: to };
}

const walls = new Map(ANN.walls.map((w) => [w.id, w]));
const openings = [...ANN.doors, ...ANN.windows];
/** Walls the plan draws without solid fill (balustrade lines, a door frame of jambs only). */
const NOT_SOLID = new Set(['w-rail-north', 'w-rail-east', 'w-int-cupboard-front']);
/** Openings across which the plan's wall fill continues (documented drawing artefacts). */
const FILLED_OPENINGS = new Set(['d-balcony']);
/** Openings drawn only in the inner half of the wall: [inner-face y0, y1). */
const HALF_FILLED: Record<string, [number, number]> = { 'win-kitchen-north': [245, 254] };
/** Door jambs are drawn as small white squares (≈7 px) at the ends of an opening. */
const JAMB = 7;

describe('E2 annotation fidelity (pixels of the real plan)', () => {
  it('decodes the plan image with the annotated size', () => {
    expect([img.width, img.height]).toEqual([ANN.image.widthPx, ANN.image.heightPx]);
  });

  it.each(ANN.walls.filter((w) => !NOT_SOLID.has(w.id)).map((w) => [w.id, w] as const))(
    'wall %s lies on wall fill',
    (_id, w) => {
      // Exclude openings in this wall from the solid check.
      const ax = wallAxis(w.rect);
      const cuts = openings
        .filter((o) => o.wallId === w.id)
        .map((o) => o.span)
        .sort((a, b) => a[0] - b[0]);
      let cursor = ax.startPx;
      let afterOpening = false;
      for (const [from, to] of [...cuts, [ax.endPx, ax.endPx] as [number, number]]) {
        const isEnd = from === ax.endPx;
        const a = cursor + (afterOpening ? JAMB : 0);
        const b = from - (isEnd ? 0 : JAMB);
        if (b - a > 4) expect(darkFraction(spanRect(w.rect, a, b))).toBeGreaterThan(0.9);
        cursor = Math.max(cursor, to);
        afterOpening = !isEnd;
      }
    },
  );

  it.each(openings.filter((o) => !FILLED_OPENINGS.has(o.id)).map((o) => [o.id, o] as const))(
    'opening %s is a gap in the wall fill',
    (_id, o) => {
      const w = walls.get(o.wallId)!;
      let r = spanRect(w.rect, o.span[0] + 3, o.span[1] - 3);
      const half = HALF_FILLED[o.id];
      if (half) r = { ...r, y0: half[0], y1: half[1] };
      expect(darkFraction(r, 0)).toBeLessThan(0.15);
    },
  );

  it.each(ANN.rooms.map((r) => [r.id, r] as const))('room %s interior is not wall', (_id, r) => {
    const xs = r.polygon.map((p) => p.x);
    const ys = r.polygon.map((p) => p.y);
    // Sample just inside each polygon edge midpoint: must be light (no wall drawn there).
    let light = 0;
    r.polygon.forEach((p, i) => {
      const q = r.polygon[(i + 1) % r.polygon.length]!;
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const sx = mx + Math.sign(cx - mx) * 4;
      const sy = my + Math.sign(cy - my) * 4;
      if (luma(sx, sy) > 150) light++;
    });
    expect(light / r.polygon.length).toBeGreaterThanOrEqual(0.75);
  });

  it('documents every opening exempted from the gap check', () => {
    const noted = ANN.drawingNotes.map((n) => n.rect).filter(Boolean) as PxRect[];
    for (const id of [...FILLED_OPENINGS, ...Object.keys(HALF_FILLED)]) {
      const o = openings.find((x) => x.id === id)!;
      expect(noted.some((r) => r.x0 <= o.span[0] + 1 && r.x1 >= o.span[1] - 1)).toBe(true);
    }
  });

  it('room polygons are bounded by walls on their non-opening sides', () => {
    // Bedroom 1: one pixel outside each edge must be dark wall fill (except the door span).
    const b1 = ANN.rooms.find((r) => r.id === 'bedroom-1')!;
    const [tl, , br] = [b1.polygon[0]!, b1.polygon[1]!, b1.polygon[2]!];
    expect(luma(tl.x - 2, (tl.y + br.y) / 2)).toBeLessThan(DARK);
    expect(luma(br.x + 2, (tl.y + br.y) / 2)).toBeLessThan(DARK);
    expect(luma(tl.x + 20, tl.y - 2)).toBeLessThan(DARK); // left of the window
    expect(luma(400, br.y + 2)).toBeLessThan(DARK);
  });
});
