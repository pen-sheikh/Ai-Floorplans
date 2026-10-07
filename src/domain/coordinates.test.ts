import { describe, expect, it } from 'vitest';
import { e2 } from '../test/fixtures';
import { planImageWorldRect, planToWorld, planTransformOf, worldToPlan } from './coordinates';

describe('plan ↔ world coordinates', () => {
  const t = { originPx: { x: 237, y: 118 }, pixelsPerMeter: 88 };

  it('maps image x → world X and image y → world Z, in metres', () => {
    expect(planToWorld({ x: 237, y: 118 }, t)).toEqual({ x: 0, z: 0 });
    const p = planToWorld({ x: 237 + 88, y: 118 + 176 }, t);
    expect(p.x).toBeCloseTo(1);
    expect(p.z).toBeCloseTo(2);
  });

  it('round-trips', () => {
    const px = { x: 812.5, y: 401.25 };
    const back = worldToPlan(planToWorld(px, t), t);
    expect(back.x).toBeCloseTo(px.x);
    expect(back.y).toBeCloseTo(px.y);
  });

  it('places the plan image so its pixels coincide with model geometry', () => {
    const apt = e2();
    const rect = planImageWorldRect(apt.coordinateSystem)!;
    const tr = planTransformOf(apt.coordinateSystem)!;
    expect(rect.width).toBeCloseTo(1485 / tr.pixelsPerMeter);
    expect(rect.center.x - rect.width / 2).toBeCloseTo(-237 / tr.pixelsPerMeter);
    expect(rect.center.z - rect.depth / 2).toBeCloseTo(-118 / tr.pixelsPerMeter);
  });
});
