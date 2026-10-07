import { describe, expect, it } from 'vitest';
import { connectedComponents, distanceTransform, fillSmallHoles, skeletonize } from './morphology';
import { countMask, newMask, type Mask } from './raster';

const fromRows = (rows: string[]): Mask => {
  const m = newMask(rows[0]!.length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => (m.data[y * m.width + x] = c === '#' ? 1 : 0)));
  return m;
};

describe('distanceTransform', () => {
  it('is the exact Euclidean distance to the nearest background pixel', () => {
    // Deterministic pseudo-random mask.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const m = newMask(24, 18);
    for (let i = 0; i < m.data.length; i++) m.data[i] = rnd() < 0.8 ? 1 : 0;
    const dt = distanceTransform(m);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (!m.data[y * m.width + x]) {
          expect(dt[y * m.width + x]).toBe(0);
          continue;
        }
        let best = Infinity;
        for (let v = 0; v < m.height; v++)
          for (let u = 0; u < m.width; u++)
            if (!m.data[v * m.width + u]) best = Math.min(best, Math.hypot(u - x, v - y));
        expect(dt[y * m.width + x]).toBeCloseTo(best, 4);
      }
    }
  });

  it('measures half the thickness on a wall centreline', () => {
    const m = newMask(40, 21);
    for (let y = 5; y < 16; y++) for (let x = 0; x < 40; x++) m.data[y * 40 + x] = 1; // 11 px thick
    expect(distanceTransform(m)[10 * 40 + 20]).toBe(6);
  });
});

describe('connectedComponents', () => {
  it('labels 8-connected blobs with areas and boxes', () => {
    const { components } = connectedComponents(
      fromRows([
        '##....#',
        '##.....',
        '..#....', // touches the first blob diagonally → same component
        '.....##',
      ]),
    );
    expect(components.map((c) => c.area).sort()).toEqual([1, 2, 5]);
    const big = components.find((c) => c.area === 5)!;
    expect(big.box).toEqual({ x0: 0, y0: 0, x1: 3, y1: 3 });
  });
});

describe('skeletonize', () => {
  it('thins a thick bar to a one-pixel line along its middle', () => {
    const m = newMask(60, 21);
    for (let y = 6; y < 15; y++) for (let x = 5; x < 55; x++) m.data[y * 60 + x] = 1; // 9 px thick
    const s = skeletonize(m);
    const rows = new Set<number>();
    for (let i = 0; i < s.data.length; i++)
      if (s.data[i] && i % 60 > 12 && i % 60 < 48) rows.add(Math.floor(i / 60));
    expect([...rows]).toEqual([10]);
    expect(countMask(s)).toBeGreaterThan(35);
  });
});

describe('fillSmallHoles', () => {
  it('fills small enclosed holes only', () => {
    const m = fromRows(['##########', '#.##.....#', '####.....#', '#..#.....#', '##########']);
    const out = fillSmallHoles(m, 3);
    expect(out.data[1 * 10 + 1]).toBe(1); // 1-pixel hole
    expect(out.data[3 * 10 + 1]).toBe(1); // 2-pixel hole
    expect(out.data[2 * 10 + 6]).toBe(0); // 15-pixel room stays open
  });
});
