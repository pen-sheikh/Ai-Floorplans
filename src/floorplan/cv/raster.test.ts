import { describe, expect, it } from 'vitest';
import {
  countMask,
  fillConvexPolygon,
  fillPolygon,
  histogram,
  newMask,
  normalizeContrast,
  otsu,
  threshold,
  toGray,
} from './raster';

describe('raster primitives', () => {
  it('converts RGBA to grey, compositing transparency over white paper', () => {
    const img = {
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]),
    };
    const g = toGray(img);
    expect(g.data[0]).toBe(0); // opaque black
    expect(g.data[1]).toBe(255); // fully transparent → paper
    expect(g.data[2]).toBe(76); // pure red luminance
  });

  it('finds a threshold between the two modes of a bimodal histogram', () => {
    const data = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = i < 300 ? 30 + (i % 10) : 220 + (i % 10);
    const t = otsu(histogram({ width: 1000, height: 1, data }));
    expect(t).toBeGreaterThanOrEqual(39);
    expect(t).toBeLessThan(220);
  });

  it('stretches a low-contrast scan to the full range', () => {
    const data = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = i < 500 ? 90 : 170;
    const n = normalizeContrast({ width: 1000, height: 1, data });
    expect(n.data[0]).toBe(0);
    expect(n.data[999]).toBe(255);
  });

  it('thresholds strictly below the level', () => {
    const m = threshold({ width: 3, height: 1, data: new Uint8Array([10, 100, 200]) }, 100);
    expect([...m.data]).toEqual([1, 0, 0]);
  });

  it('fills convex and concave polygons at pixel centres', () => {
    const sq = newMask(20, 20);
    fillConvexPolygon(sq, [
      { x: 2, y: 2 },
      { x: 12, y: 2 },
      { x: 12, y: 8 },
      { x: 2, y: 8 },
    ]);
    expect(countMask(sq)).toBe(60);
    // L-shape: 10×10 square minus a 5×5 notch = 75 pixels.
    const l = newMask(20, 20);
    fillPolygon(l, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(countMask(l)).toBe(75);
    expect(l.data[7 * 20 + 7]).toBe(0); // inside the notch
  });
});
