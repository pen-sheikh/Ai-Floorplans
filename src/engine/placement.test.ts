import { describe, expect, it } from 'vitest';
import { getCatalogItem } from '../catalog/furnitureCatalog';
import { pointAlongWall, polygonCentroid } from '../domain/geometry';
import type { FurnitureItem, Vec2 } from '../domain/types';
import { e2Floor, room } from '../test/fixtures';
import { DEFAULT_CONSTRAINTS, type PlacementConstraints } from './constraints';
import { checkPlacement, doorZones, type PlacementSubject } from './placement';

const C: PlacementConstraints = { ...DEFAULT_CONSTRAINTS, blocking: [...DEFAULT_CONSTRAINTS.blocking] };

function subject(catalogId: string, roomId: string, position: Vec2, rotation = 0): PlacementSubject {
  return { catalogId, roomId, position, rotation, dimensions: getCatalogItem(catalogId)!.dimensions };
}

const codes = (r: ReturnType<typeof checkPlacement>) => r.issues.map((i) => i.code);

describe('placement checks on the E2 plan', () => {
  const floor = e2Floor();
  const living = room(floor, 'kitchen-living');
  const centre = polygonCentroid(living.polygon);

  it('accepts a coffee table in the middle of the open-plan room', () => {
    const r = checkPlacement(
      floor,
      subject('coffee-table', living.id, { x: centre.x, z: centre.z - 0.6 }),
      C,
    );
    expect(r.hard).toBe(false);
    expect(r.roomId).toBe(living.id);
  });

  it('detects leaving the room / crossing a wall', () => {
    const wall = floor.walls.find((w) => w.id === 'w-ext-east')!;
    const onWall = pointAlongWall(wall, 2);
    const r = checkPlacement(floor, subject('coffee-table', living.id, onWall), C);
    expect(codes(r)).toEqual(expect.arrayContaining(['outside-room', 'wall-collision']));
    expect(r.blocked).toBe(true);
  });

  it('detects collisions with fixed objects drawn on the plan (bath, counters)', () => {
    const bath = floor.fixtures.find((f) => f.id === 'fx-bath')!;
    const r = checkPlacement(floor, subject('plant', 'bathroom', polygonCentroid(bath.footprint)), C);
    expect(codes(r)).toContain('fixture-collision');
    const hob = floor.fixtures.find((f) => f.id === 'fx-counter-south')!;
    expect(
      codes(checkPlacement(floor, subject('plant', living.id, polygonCentroid(hob.footprint)), C)),
    ).toContain('fixture-collision');
  });

  it('detects collisions with other furniture but lets rugs sit underneath', () => {
    const table: FurnitureItem = {
      ...subject('dining-table-4', living.id, centre),
      id: 'table',
      name: 'Dining table',
      category: 'dining-table',
      elevation: 0,
      materialId: 'wood-oak',
    };
    const withTable = { ...floor, furniture: [table] };
    expect(codes(checkPlacement(withTable, subject('armchair', living.id, centre), C))).toContain(
      'furniture-collision',
    );
    expect(codes(checkPlacement(withTable, subject('rug', living.id, centre), C))).not.toContain(
      'furniture-collision',
    );
  });

  it('keeps the swing of the Bedroom 1 door clear', () => {
    const door = floor.doors.find((d) => d.id === 'd-bed1')!;
    const wall = floor.walls.find((w) => w.id === door.wallId)!;
    const swing = doorZones(door, wall, C).swing!;
    const inSwing = polygonCentroid(swing);
    const r = checkPlacement(floor, subject('plant', 'bedroom-1', inSwing), C);
    expect(codes(r)).toContain('door-swing');
    // The swing zone lies inside Bedroom 1, as drawn on the plan.
    expect(r.roomId).toBe('bedroom-1');
    const relaxed = checkPlacement(floor, subject('plant', 'bedroom-1', inSwing), {
      ...C,
      respectDoorSwings: false,
    });
    expect(codes(relaxed)).not.toContain('door-swing');
    expect(codes(relaxed)).toContain('door-clearance');
  });

  it('rotation changes the footprint (a sofa fits one way along a narrow space but not the other)', () => {
    // Bathroom is 2.31 × 1.69 m: a 2.2 m sofa fits along X but not along Z.
    const b = polygonCentroid(room(floor, 'bathroom').polygon);
    const along = checkPlacement(floor, subject('sofa-3', 'bathroom', b, 0), C);
    const across = checkPlacement(floor, subject('sofa-3', 'bathroom', b, Math.PI / 2), C);
    expect(codes(across)).toContain('outside-room');
    expect(codes(along)).not.toContain('outside-room');
  });

  it('flags missing front clearance as a soft issue', () => {
    // Sofa facing the east wall from 0.3 m away.
    const r = checkPlacement(
      floor,
      subject('sofa-3', living.id, { x: living.polygon[1]!.x - 0.75, z: centre.z }, Math.PI / 2),
      C,
    );
    expect(r.issues.find((i) => i.code === 'front-clearance')?.severity).toBe('soft');
  });

  it('reports a room change when moved fully into another room', () => {
    const b1 = polygonCentroid(room(floor, 'bedroom-1').polygon);
    const r = checkPlacement(floor, subject('plant', living.id, b1), C);
    expect(r.roomId).toBe('bedroom-1');
    expect(codes(r)).not.toContain('outside-room');
  });
});
