import { describe, expect, it } from 'vitest';
import type { AnnotatedWall } from '../annotationTypes';
import { SYNTHETIC_CORRIDOR_ANNOTATIONS as GT } from '../fixtures/synthetic-corridor/annotations';
import { compareAnnotations, formatMetrics, stats } from './metrics';

const shift = (w: AnnotatedWall, dx: number): AnnotatedWall =>
  'segment' in w
    ? {
        ...w,
        segment: {
          ...w.segment,
          a: { x: w.segment.a.x + dx, y: w.segment.a.y },
          b: { x: w.segment.b.x + dx, y: w.segment.b.y },
        },
      }
    : w;

describe('compareAnnotations', () => {
  it('scores ground truth against itself as perfect', () => {
    const m = compareAnnotations(GT, GT);
    expect(m.walls.detectionRate).toBe(1);
    expect(m.walls.endpointErrorM.max).toBe(0);
    expect(m.walls.kindCorrect).toBe(GT.walls.length);
    expect(m.rooms.matched).toBe(GT.rooms.length);
    expect(m.rooms.minIoU).toBe(1);
    expect(m.doors.detectionRate).toBe(1);
    expect(m.doors.swingCorrect).toBe(m.doors.hingedCompared);
    expect(m.windows.widthErrorM.max).toBe(0);
    expect(m.scale.relativeError).toBe(0);
  });

  it('measures errors in metres at the ground-truth scale', () => {
    // Move every vertical wall 4 px (0.1 m at 40 px/m) to the right.
    const moved = {
      ...GT,
      walls: GT.walls.map((w) => ('segment' in w && w.segment.a.x === w.segment.b.x ? shift(w, 4) : w)),
    };
    const m = compareAnnotations(GT, moved);
    expect(m.walls.endpointErrorM.max).toBeCloseTo(0.1, 2);
  });

  it('counts misses and false positives', () => {
    const doors = GT.doors.slice(1);
    const extra = {
      ...GT.windows[0]!,
      id: 'ghost',
      span: [100, 130] as [number, number],
      wallId: 'ext-left',
    };
    const m = compareAnnotations(GT, { ...GT, doors, windows: [...GT.windows, extra] });
    expect(m.doors.missed).toEqual([GT.doors[0]!.id]);
    expect(m.windows.falsePositives).toBe(1);
  });

  it('formats a readable report', () => {
    const text = formatMetrics('corridor', compareAnnotations(GT, GT));
    expect(text).toMatch(/walls: 14\/14 detected/);
    expect(stats([3, 1, 2])).toEqual({ mean: 2, median: 2, max: 3, n: 3 });
  });
});
