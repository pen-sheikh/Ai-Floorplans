import { describe, expect, it } from 'vitest';
import { add, pointAlongWall, polygonArea, scale, wallNormal } from '../domain/geometry';
import { deriveTopology } from '../domain/topology';
import type { Floor, Wall } from '../domain/types';
import { validateApartment } from '../domain/validation';
import { buildApartment } from '../floorplan';
import { SYNTHETIC_ANNOTATIONS } from '../floorplan/fixtures/synthetic/annotations';
import { SYNTHETIC_CORRIDOR_ANNOTATIONS } from '../floorplan/fixtures/synthetic-corridor/annotations';
import { SYNTHETIC_MM_ANNOTATIONS } from '../floorplan/fixtures/synthetic-mm/annotations';
import { e2, e2Floor } from '../test/fixtures';
import { applyCommand, CommandError } from './commands';
import { planWallMove } from './operations';
import { moveWall } from './wallMove';

const ok = (floor: Floor, id: string, distance: number) => {
  const r = moveWall(floor, id, distance);
  if (!r.ok) throw new Error(`expected ${id} to move: ${r.reason}`);
  return r;
};
const wallOf = (f: Floor, id: string): Wall => f.walls.find((w) => w.id === id)!;
const roomOf = (f: Floor, id: string) => f.rooms.find((r) => r.id === id)!;
const close = (a: { x: number; z: number }, b: { x: number; z: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.z).toBeCloseTo(b.z, 9);
};

describe('moving an interior wall (E2)', () => {
  const f0 = e2Floor();
  const id = 'w-int-hall-north'; // between the bedrooms and the hall
  const w0 = wallOf(f0, id);
  const delta = scale(wallNormal(w0), 0.1);
  const r = ok(f0, id, 0.1);
  const f = r.floor;

  it('moves the wall itself 0.1 m along its normal, keeping its length between perpendicular walls', () => {
    close(wallOf(f, id).start, add(w0.start, delta));
    close(wallOf(f, id).end, add(w0.end, delta));
  });

  it('slides the ends of walls that meet it, so every junction still closes', () => {
    for (const other of ['w-int-bed1-bed2', 'w-int-wardrobe-west', 'w-int-wardrobe-east']) {
      const before = wallOf(f0, other);
      const after = wallOf(f, other);
      close(after.start, before.start); // the far end stays
      close(after.end, add(before.end, delta)); // the end on the moved wall follows it
    }
    expect(r.changedWalls.sort()).toEqual(
      [id, 'w-int-bed1-bed2', 'w-int-wardrobe-east', 'w-int-wardrobe-west'].sort(),
    );
  });

  it('moves the room edges on both faces and leaves other edges where they were', () => {
    const b0 = roomOf(f0, 'bedroom-1');
    const b1 = roomOf(f, 'bedroom-1');
    b1.polygon.forEach((p, i) => {
      const q = b0.polygon[i]!;
      const onFace = Math.abs(q.z - (w0.start.z - w0.thickness / 2)) < 1e-6;
      close(p, onFace ? add(q, delta) : q);
    });
    // Space moves from one side to the other. The only floor area lost is what the attached
    // partitions now cover, being 0.1 m longer: rooms + walls are conserved exactly.
    const area = (fl: Floor) => fl.rooms.reduce((s, x) => s + polygonArea(x.polygon), 0);
    const attached = r.changedWalls.filter((w) => w !== id).map((w) => wallOf(f0, w).thickness);
    expect(area(f)).toBeCloseTo(area(f0) - 0.1 * attached.reduce((s, t) => s + t, 0), 9);
    expect(polygonArea(roomOf(f, 'hall').polygon)).toBeLessThan(polygonArea(roomOf(f0, 'hall').polygon));
    expect(r.changedRooms.sort()).toEqual([
      'bedroom-1',
      'bedroom-2',
      'cupboard-hall-north',
      'hall',
      'wardrobe-bed2',
    ]);
  });

  it('carries its doors with it, at the same place along the wall', () => {
    for (const d of f0.doors.filter((x) => x.wallId === id)) {
      const after = f.doors.find((x) => x.id === d.id)!;
      expect(after.offset).toBeCloseTo(d.offset, 9);
      close(pointAlongWall(wallOf(f, id), after.offset), add(pointAlongWall(w0, d.offset), delta));
    }
  });

  it('re-derives topology from the new geometry', () => {
    expect(deriveTopology(f)).toEqual(f);
    const door = f.doors.find((d) => d.id === 'd-bed1')!;
    expect(door.connects).toEqual(f0.doors.find((d) => d.id === 'd-bed1')!.connects);
  });

  it('marks exactly the changed walls and rooms as user-corrected', () => {
    for (const w of f.walls)
      expect(w.sources.geometry).toBe(
        r.changedWalls.includes(w.id) ? 'user' : wallOf(f0, w.id).sources.geometry,
      );
    for (const room of f.rooms) {
      const before = roomOf(f0, room.id);
      expect(room.sources).toEqual(
        r.changedRooms.includes(room.id) ? { ...before.sources, geometry: 'user' } : before.sources,
      );
    }
  });

  it('leaves everything else untouched (names, types, finishes, fixtures, furniture, other walls)', () => {
    expect(f.fixtures).toBe(f0.fixtures);
    expect(f.furniture).toBe(f0.furniture);
    expect(f.footprint).toBe(f0.footprint);
    expect(wallOf(f, 'w-ext-north')).toBe(wallOf(f0, 'w-ext-north'));
    expect(roomOf(f, 'bathroom')).toEqual(roomOf(f0, 'bathroom'));
    for (const room of f.rooms) {
      const before = roomOf(f0, room.id);
      expect([room.name, room.type, room.labelSource, room.renovation, room.ceilingHeight]).toEqual([
        before.name,
        before.type,
        before.labelSource,
        before.renovation,
        before.ceilingHeight,
      ]);
    }
    for (const d of f.doors) {
      const before = f0.doors.find((x) => x.id === d.id)!;
      expect([d.width, d.kind, d.hinge, d.swingSide, d.sources]).toEqual([
        before.width,
        before.kind,
        before.hinge,
        before.swingSide,
        before.sources,
      ]);
    }
  });

  it('is deterministic and exactly reversible', () => {
    expect(ok(f0, id, 0.1).floor).toEqual(f);
    const back = ok(f, id, -0.1).floor;
    for (const w of f0.walls) {
      close(wallOf(back, w.id).start, w.start);
      close(wallOf(back, w.id).end, w.end);
    }
    for (const room of f0.rooms) roomOf(back, room.id).polygon.forEach((p, i) => close(p, room.polygon[i]!));
  });

  it('keeps openings in place on an attached wall whose start slides (L-corner)', () => {
    // The cupboard front starts on the cupboard top's face: moving the top slides that start.
    const g = ok(f0, 'w-int-cupboard-top', 0.1).floor;
    const front0 = wallOf(f0, 'w-int-cupboard-front');
    const front = wallOf(g, 'w-int-cupboard-front');
    expect(front.start).not.toEqual(front0.start);
    for (const d0 of f0.doors.filter((d) => d.wallId === front0.id)) {
      const d = g.doors.find((x) => x.id === d0.id)!;
      close(pointAlongWall(front, d.offset), pointAlongWall(front0, d0.offset));
    }
  });
});

describe('refused wall moves (never approximated)', () => {
  const f0 = e2Floor();
  const reason = (floor: Floor, id: string, distance: number) => {
    const r = moveWall(floor, id, distance);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.reason;
  };

  it('refuses exterior walls and railings (they define the building outline)', () => {
    expect(reason(f0, 'w-ext-north', 0.1)).toMatch(/exterior wall/);
    expect(reason(f0, 'w-rail-north', 0.1)).toMatch(/railing/);
  });

  it('refuses a wall that continues in a straight line into another wall', () => {
    expect(reason(f0, 'w-int-kitchen-hall', 0.1)).toMatch(/continues in a straight line/);
  });

  it('refuses an interior wall that is part of the building outline', () => {
    const angled = buildApartment(SYNTHETIC_ANNOTATIONS).apartment.floors[0]!;
    expect(reason(angled, 'middle', 0.1)).toMatch(/building outline/);
  });

  it('refuses an ambiguous junction (a wall stopping short of the moved wall)', () => {
    // Shorten a partition so it ends 10 cm before the wall it used to meet.
    const shortened: Floor = {
      ...f0,
      walls: f0.walls.map((w) =>
        w.id === 'w-int-bed1-bed2' ? { ...w, end: { ...w.end, z: w.end.z - 0.1 } } : w,
      ),
    };
    expect(reason(shortened, 'w-int-hall-north', 0.1)).toMatch(/ambiguous/);
  });

  it('refuses a move that would collapse an attached wall', () => {
    expect(reason(f0, 'w-int-bed2-south', 0.62)).toMatch(/collapse/);
  });

  it('refuses zero, non-finite and unknown input', () => {
    expect(reason(f0, 'w-int-bed1-bed2', 0)).toMatch(/non-zero/);
    expect(reason(f0, 'w-int-bed1-bed2', Number.NaN)).toMatch(/non-zero/);
    expect(reason(f0, 'nope', 0.1)).toMatch(/not found/);
  });

  it('surfaces refusals as command errors, and validation failures through the planner', () => {
    expect(() => applyCommand(e2(), { type: 'wall/move', id: 'w-ext-north', distance: 0.1 })).toThrow(
      CommandError,
    );
    // Geometrically possible, but the cupboard door would no longer fit its (shortened) wall.
    const plan = planWallMove(e2(), 'w-int-bath-north', -0.1);
    expect(plan.command).toBeUndefined();
    expect(plan.result.reason).toMatch(/d-cupboard-a/);
  });

  it('reports new warnings instead of hiding them', () => {
    const plan = planWallMove(e2(), 'w-int-bath-north', 0.1);
    expect(plan.command).toEqual({ type: 'wall/move', id: 'w-int-bath-north', distance: 0.1 });
    expect(plan.result.warnings.join(' ')).toMatch(/Bath/);
  });
});

describe('generic: any plan, any accepted move stays a valid model', () => {
  const plans = {
    e2: e2(),
    'synthetic-corridor': buildApartment(SYNTHETIC_CORRIDOR_ANNOTATIONS).apartment,
    'synthetic-mm': buildApartment(SYNTHETIC_MM_ANNOTATIONS).apartment,
  };
  for (const [name, apt] of Object.entries(plans)) {
    it(`${name}: accepted moves add no validation errors and keep topology consistent`, () => {
      const errors = (a: typeof apt) =>
        validateApartment(a).issues.filter((i) => i.severity === 'error').length;
      let accepted = 0;
      for (const w of apt.floors[0]!.walls.filter((x) => x.kind === 'interior')) {
        for (const distance of [0.05, -0.05]) {
          const plan = planWallMove(apt, w.id, distance);
          if (!plan.command) continue;
          accepted++;
          const next = applyCommand(apt, plan.command);
          expect(errors(next)).toBeLessThanOrEqual(errors(apt));
          const f = next.floors[0]!;
          expect(deriveTopology(f)).toEqual(f);
          const moved = wallOf(f, w.id);
          const mid = (x: Wall) => ({ x: (x.start.x + x.end.x) / 2, z: (x.start.z + x.end.z) / 2 });
          const n = wallNormal(w);
          const shift = (mid(moved).x - mid(w).x) * n.x + (mid(moved).z - mid(w).z) * n.z;
          expect(shift).toBeCloseTo(distance, 9);
        }
      }
      expect(accepted).toBeGreaterThan(0);
    });
  }
});
