import { describe, expect, it } from 'vitest';
import type { AnnotatedDoor, AnnotatedWindow } from '../annotationTypes';
import { DEFAULT_PLAN_STYLE } from '../fixtures/render/planSvg';
import { box, detectOnPlan, miniPlan, wall } from '../../test/miniPlan';
import type { DetectedOpening } from './openings';
import { segDir, type DetectedWall } from './walls';

/** Box 40..360 × 40..260 (12 px external walls) with a partition at x = 200. */
const walls = () => [
  ...box(40, 40, 360, 260, 12),
  wall('mid', { x: 200, y: 40 }, { x: 200, y: 260 }, 6, 'interior'),
];
const run = (doors: AnnotatedDoor[] = [], windows: AnnotatedWindow[] = [], style = DEFAULT_PLAN_STYLE) =>
  detectOnPlan(miniPlan(400, 300, walls(), doors, windows), style).openings;

/** Opening span in image coordinates along the host wall's dominant axis. */
function span(o: DetectedOpening, ws: DetectedWall[]): [number, number] {
  const w = ws.find((x) => x.id === o.wallId)!;
  const d = segDir(w);
  const horizontal = Math.abs(d.x) >= Math.abs(d.y);
  const at = (t: number) => (horizontal ? w.a.x + d.x * t : w.a.y + d.y * t);
  return [at(o.from), at(o.to)].sort((p, q) => p - q) as [number, number];
}

describe('detectOpenings', () => {
  it('finds a hinged door from its leaf and swing arc, with hinge and swing side', () => {
    const r = run([
      { id: 'd', wallId: 'bottom', span: [100, 148], kind: 'hinged', hinge: 'min', swing: 'up' },
    ]);
    const doors = r.openings.filter((o) => o.kind === 'door');
    expect(doors).toHaveLength(1);
    const d = doors[0]!;
    expect(d.doorKind).toBe('hinged');
    const [a, b] = span(d, r.walls);
    expect(a).toBeCloseTo(100, -0.3);
    expect(b).toBeCloseTo(148, -0.3);
    const w = r.walls.find((x) => x.id === d.wallId)!;
    // Hinge at the lower x end; leaf swings up (−y) into the room.
    const hingeAtLowX = (d.hinge === 'start') === segDir(w).x > 0;
    expect(hingeAtLowX).toBe(true);
    const normalY = segDir(w).x; // left normal of a horizontal wall: (−d.y, d.x) → y = d.x
    expect(Math.sign(normalY * d.swingSide!)).toBe(-1);
    expect(d.confidence).toBeGreaterThan(0.8);
  });

  it('recognises a double door', () => {
    const r = run([
      { id: 'd', wallId: 'top', span: [240, 320], kind: 'double', hinge: 'min', swing: 'down' },
    ]);
    const d = r.openings.find((o) => o.kind === 'door');
    expect(d?.doorKind).toBe('double');
  });

  it('recognises a window from the glazing lines inside the wall band', () => {
    const r = run([], [{ id: 'w', wallId: 'right', span: [100, 180], kind: 'standard' }]);
    expect(r.openings.map((o) => o.kind)).toEqual(['window']);
    const [a, b] = span(r.openings[0]!, r.walls);
    // Within the 1.4 px end strokes of the symbol.
    expect(Math.abs(a - 100)).toBeLessThan(2.5);
    expect(Math.abs(b - 180)).toBeLessThan(2.5);
  });

  it('keeps a symbol-less gap between collinear walls as an uncertain opening, not a door', () => {
    const r = run([
      { id: 'o', wallId: 'mid', span: [120, 160], kind: 'opening', hinge: 'min', swing: 'left' },
    ]);
    expect(r.openings).toHaveLength(1);
    expect(r.openings[0]!.kind).toBe('opening');
    expect(r.openings[0]!.confidence).toBeLessThan(0.6);
  });

  it('measures the clear opening between drawn door frames (jamb boxes)', () => {
    const r = run(
      [{ id: 'd', wallId: 'bottom', span: [100, 148], kind: 'hinged', hinge: 'min', swing: 'up' }],
      [],
      { ...DEFAULT_PLAN_STYLE, doorJambPx: 5 },
    );
    const d = r.openings.find((o) => o.kind === 'door')!;
    const [a, b] = span(d, r.walls);
    expect(Math.abs(a - 100)).toBeLessThan(1.5);
    expect(Math.abs(b - 148)).toBeLessThan(1.5);
  });

  it('splits a gap at a short pier: a door and a window side by side stay separate', () => {
    const r = run(
      [{ id: 'd', wallId: 'bottom', span: [80, 128], kind: 'hinged', hinge: 'min', swing: 'up' }],
      [{ id: 'w', wallId: 'bottom', span: [142, 190], kind: 'standard' }],
    );
    expect(r.openings.map((o) => o.kind).sort()).toEqual(['door', 'window']);
  });

  it('finds nothing in plain walls', () => {
    expect(run().openings).toEqual([]);
  });

  it('bridges the walls an opening interrupts', () => {
    const r = run([
      { id: 'd', wallId: 'bottom', span: [100, 148], kind: 'hinged', hinge: 'min', swing: 'up' },
    ]);
    // The bottom wall is one wall across the door, not two pieces.
    const bottoms = r.walls.filter((w) => Math.abs(w.a.y - 260) < 2 && Math.abs(w.b.y - 260) < 2);
    expect(bottoms).toHaveLength(1);
  });
});
