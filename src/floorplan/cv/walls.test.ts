import { describe, expect, it } from 'vitest';
import { box, miniPlan, wall } from '../../test/miniPlan';
import { rasterPlan } from '../../test/rasterPlan';
import { preprocessImage, wallThicknessProfile } from './preprocess';
import { newMask } from './raster';
import { detectWalls, lineSegments, segDir, segLength, type DetectedWall } from './walls';

const run = (ann: ReturnType<typeof miniPlan>) => {
  const pre = preprocessImage(rasterPlan(ann));
  const profile = wallThicknessProfile(pre);
  return detectWalls(pre, profile);
};
const near = (p: { x: number; y: number }, q: { x: number; y: number }, tol = 1.5) =>
  Math.hypot(p.x - q.x, p.y - q.y) <= tol;
const hasEnd = (ws: DetectedWall[], p: { x: number; y: number }, tol = 1.5) =>
  ws.some((w) => near(w.a, p, tol) || near(w.b, p, tol));

describe('wall thickness profile', () => {
  it('finds the external and partition classes and ignores thin linework', () => {
    const ann = miniPlan(400, 300, [
      ...box(50, 50, 350, 250, 16),
      wall('part', { x: 200, y: 50 }, { x: 200, y: 250 }, 8, 'interior'),
      // Thin furniture-like lines must not create a wall class.
      wall('thin', { x: 80, y: 200 }, { x: 160, y: 200 }, 1.2, 'interior'),
    ]);
    const { profile } = run(ann);
    expect(profile.major).toBeGreaterThanOrEqual(15);
    expect(profile.major).toBeLessThanOrEqual(17);
    expect(profile.minor).toBeGreaterThanOrEqual(7);
    expect(profile.minor).toBeLessThanOrEqual(9);
  });
});

describe('detectWalls', () => {
  it('vectorises a closed box: four walls meeting at L-corners on the centreline intersections', () => {
    const { walls } = run(miniPlan(300, 240, box(40, 40, 260, 200, 12)));
    expect(walls).toHaveLength(4);
    for (const c of [
      { x: 40, y: 40 },
      { x: 260, y: 40 },
      { x: 260, y: 200 },
      { x: 40, y: 200 },
    ]) {
      // Corners land on the centreline intersection or the outer face (within half a thickness).
      expect(hasEnd(walls, c, 6.5)).toBe(true);
    }
    for (const w of walls) {
      expect(w.thickness).toBeGreaterThanOrEqual(11);
      expect(w.thickness).toBeLessThanOrEqual(13);
      expect(w.confidence).toBeGreaterThan(0.8);
    }
  });

  it('ends a T-junction stem exactly on the host wall centreline', () => {
    const { walls } = run(
      miniPlan(300, 240, [
        ...box(40, 40, 260, 200, 12),
        wall('stem', { x: 150, y: 40 }, { x: 150, y: 200 }, 6, 'interior'),
      ]),
    );
    const stem = walls.find((w) => Math.abs(w.a.x - w.b.x) < 1 && Math.abs(w.a.x - 150) < 1.5)!;
    expect(stem).toBeDefined();
    expect(Math.min(stem.a.y, stem.b.y)).toBeCloseTo(40, 0);
    expect(Math.max(stem.a.y, stem.b.y)).toBeCloseTo(200, 0);
    expect(stem.ends).toEqual(['junction', 'junction']);
    expect(stem.thickness).toBeLessThan(8);
  });

  it('keeps an angled wall at its true angle', () => {
    const { walls } = run(
      miniPlan(400, 320, [
        wall('top', { x: 40, y: 40 }, { x: 300, y: 40 }, 10),
        wall('right', { x: 300, y: 40 }, { x: 300, y: 140 }, 10),
        wall('diag', { x: 300, y: 140 }, { x: 180, y: 260 }, 10),
        wall('bottom', { x: 40, y: 260 }, { x: 180, y: 260 }, 10),
        wall('left', { x: 40, y: 40 }, { x: 40, y: 260 }, 10),
      ]),
    );
    const diag = walls.find((w) => {
      const d = segDir(w);
      return Math.abs(Math.abs(d.x) - Math.abs(d.y)) < 0.1;
    });
    expect(diag).toBeDefined();
    expect(segLength(diag!)).toBeGreaterThan(150);
    const angle =
      (Math.atan2(Math.abs(diag!.b.y - diag!.a.y), Math.abs(diag!.b.x - diag!.a.x)) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(43);
    expect(angle).toBeLessThan(47);
  });
});

describe('lineSegments', () => {
  it('turns thin linework into straight pieces', () => {
    const m = newMask(200, 100);
    for (let x = 20; x < 180; x++) m.data[50 * 200 + x] = 1;
    for (let y = 10; y < 90; y++) m.data[y * 200 + 100] = 1;
    const segs = lineSegments(m, 20);
    expect(segs.length).toBeGreaterThanOrEqual(4); // the cross splits both lines at the junction
    expect(segs.every((s) => Math.abs(s.a.x - s.b.x) < 1 || Math.abs(s.a.y - s.b.y) < 1)).toBe(true);
  });
});
