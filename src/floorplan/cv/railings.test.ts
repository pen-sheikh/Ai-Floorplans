import { describe, expect, it } from 'vitest';
import { box, detectOnPlan, miniPlan, wall } from '../../test/miniPlan';
import { paintLine } from '../../test/rasterPlan';
import { preprocessImage, wallThicknessProfile } from './preprocess';
import { detectHollowBands } from './railings';
import { detectWalls } from './walls';

/** A 12 px-walled box with a balcony on its right, enclosed by a 6 px hollow railing. */
const balconyPlan = () =>
  miniPlan(460, 300, [
    ...box(40, 40, 300, 260, 12),
    wall('rail-n', { x: 306, y: 80 }, { x: 400, y: 80 }, 6, 'railing'),
    wall('rail-e', { x: 400, y: 80 }, { x: 400, y: 200 }, 6, 'railing'),
    wall('rail-s', { x: 306, y: 200 }, { x: 400, y: 200 }, 6, 'railing'),
  ]);

describe('detectHollowBands', () => {
  it('finds a railing drawn as two parallel thin lines connected to the walls', () => {
    const { ctx, openings } = detectOnPlan(balconyPlan());
    const bands = detectHollowBands(ctx, openings.walls);
    expect(bands).toHaveLength(3);
    for (const b of bands) {
      expect(b.thickness).toBeGreaterThan(5);
      expect(b.thickness).toBeLessThan(9);
    }
    // The corners are closed: the east band meets both others.
    const east = bands.find((b) => Math.abs(b.a.x - b.b.x) < 1)!;
    expect(Math.abs(east.a.x - 400)).toBeLessThan(1.5);
    expect(Math.min(east.a.y, east.b.y)).toBeLessThan(83);
    expect(Math.max(east.a.y, east.b.y)).toBeGreaterThan(197);
  });

  it('ignores a free-standing pair of lines (furniture, fittings)', () => {
    const r = detectOnPlan(miniPlan(400, 300, box(40, 40, 360, 260, 12)));
    for (const y of [140, 146]) paintLine(r.img, { x: 120, y }, { x: 260, y }, 1.2, 60);
    const pre = preprocessImage(r.img);
    const profile = wallThicknessProfile(pre);
    const walls = detectWalls(pre, profile);
    expect(
      detectHollowBands(
        { gray: pre.gray, wallMask: walls.wallMask, lineThreshold: 215, profile },
        walls.walls,
      ),
    ).toEqual([]);
  });

  it('ignores parallel lines with ink between them (window glazing has a middle line)', () => {
    const r = detectOnPlan(miniPlan(400, 300, box(40, 40, 360, 260, 12)));
    // Three lines from wall to wall: not hollow.
    for (const y of [140, 143, 146]) paintLine(r.img, { x: 46, y }, { x: 354, y }, 1.2, 60);
    const pre = preprocessImage(r.img);
    const profile = wallThicknessProfile(pre);
    const walls = detectWalls(pre, profile);
    expect(
      detectHollowBands(
        { gray: pre.gray, wallMask: walls.wallMask, lineThreshold: 215, profile },
        walls.walls,
      ),
    ).toEqual([]);
  });
});
