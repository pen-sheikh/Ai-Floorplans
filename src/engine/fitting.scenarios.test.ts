import { describe, expect, it } from 'vitest';
import { getCatalogItem, type FurnitureCatalogItem } from '../catalog/furnitureCatalog';
import {
  polygonBounds,
  polygonCentroid,
  polygonContainsPolygon,
  polygonOverlapDepth,
  vec,
} from '../domain/geometry';
import type { Floor, Vec2 } from '../domain/types';
import { buildApartment } from '../floorplan';
import { SYNTHETIC_ANNOTATIONS } from '../floorplan/fixtures/synthetic/annotations';
import { e2Floor, room, testId } from '../test/fixtures';
import { DEFAULT_CONSTRAINTS, type PlacementConstraints } from './constraints';
import { explainFit, fitFurniture } from './fitting';
import { checkPlacement, doorZones, furnitureFootprint } from './placement';

const C: PlacementConstraints = { ...DEFAULT_CONSTRAINTS, blocking: [...DEFAULT_CONSTRAINTS.blocking] };
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

/** A bare floor with one rectangular room — no walls, doors or fixtures — for pure-geometry cases. */
function boxFloor(w: number, d: number): Floor {
  const polygon: Vec2[] = [vec(0, 0), vec(w, 0), vec(w, d), vec(0, d)];
  return {
    id: 'f',
    name: 'test',
    level: 0,
    elevation: 0,
    height: 2.4,
    heightSource: 'assumed',
    footprint: polygon,
    rooms: [
      {
        id: 'box',
        name: 'Box room',
        type: 'living',
        labelSource: 'user',
        polygon,
        ceilingHeight: 2.4,
        exterior: false,
        sources: { geometry: 'user', ceilingHeight: 'assumed' },
        wallIds: [],
        doorIds: [],
        windowIds: [],
        renovation: {
          wallMaterialId: 'paint-white',
          floorMaterialId: 'floor-oak',
          ceilingMaterialId: 'ceiling-white',
          trimMaterialId: 'wood-white',
          doorMaterialId: 'wood-white',
          windowMaterialId: 'upvc-white',
          lighting: 'neutral',
        },
      },
    ],
    walls: [],
    doors: [],
    windows: [],
    stairs: [],
    fixtures: [],
    furniture: [],
  };
}

/** A custom catalog entry (proves the engine reads rules from the injected catalog, not globals). */
const testBox = (width: number, depth: number): FurnitureCatalogItem => ({
  ...getCatalogItem('coffee-table')!,
  id: 'test-box',
  name: 'Test box',
  dimensions: { width, depth, height: 0.5 },
  placement: { againstWall: false, preferWall: 'any', frontClearance: 0, collides: true, roomTypes: [] },
});
const catalogWith = (item: FurnitureCatalogItem) => (id: string) =>
  id === item.id ? item : getCatalogItem(id);

describe('furniture fitting scenarios', () => {
  const floor = e2Floor();

  it('1. fits a sofa in the living room, back to the wall, facing the room', () => {
    const { placements } = fitFurniture(floor, 'kitchen-living', [{ catalogId: 'sofa-3' }], C, testId);
    const p = placements[0]!;
    expect(p.ok).toBe(true);
    expect(p.issues).toEqual([]);
    expect(checkPlacement(floor, p.item!, C).hard).toBe(false);
  });

  it('2. fits a king-size bed in Bedroom 1', () => {
    const p = fitFurniture(floor, 'bedroom-1', [{ catalogId: 'bed-king' }], C, testId).placements[0]!;
    expect(p.ok).toBe(true);
    expect(polygonContainsPolygon(room(floor, 'bedroom-1').polygon, furnitureFootprint(p.item!))).toBe(true);
  });

  it('3. rejects furniture larger than the room, without searching', () => {
    const p = fitFurniture(floor, 'cupboard-airing', [{ catalogId: 'bed-king' }], C, testId).placements[0]!;
    expect(p).toMatchObject({ ok: false, failure: 'too-large', candidatesTried: 0 });
    expect(p.reason).toMatch(/larger than Cupboard \(bifold\).*in every orientation/);
  });

  it('4. reports wall intersections with their depth', () => {
    const b1 = room(floor, 'bedroom-1');
    const minX = polygonBounds(b1.polygon).minX;
    const r = checkPlacement(
      floor,
      {
        catalogId: 'plant',
        roomId: b1.id,
        position: vec(minX + 0.1, 2),
        rotation: 0,
        dimensions: { width: 1, depth: 1, height: 1 },
      },
      C,
    );
    const wall = r.issues.find((i) => i.code === 'wall-collision')!;
    expect(wall).toMatchObject({ category: 'structural', severity: 'hard' });
    expect(wall.amount).toBeGreaterThan(0.1);
    expect(codes(r.issues)).toContain('outside-room');
    expect(r.issues.find((i) => i.code === 'outside-room')!.amount).toBeCloseTo(0.4, 1);
  });

  it('5. reports a blocked door swing as a functional-zone violation', () => {
    const door = floor.doors.find((d) => d.id === 'd-bed1')!;
    const wall = floor.walls.find((w) => w.id === door.wallId)!;
    const r = checkPlacement(
      floor,
      {
        catalogId: 'plant',
        roomId: 'bedroom-1',
        position: polygonCentroid(doorZones(door, wall, C).swing!),
        rotation: 0,
        dimensions: { width: 0.4, depth: 0.4, height: 1 },
      },
      C,
    );
    const swing = r.issues.find((i) => i.code === 'door-swing')!;
    expect(swing).toMatchObject({ category: 'functional', severity: 'hard', otherId: 'd-bed1' });
    expect(swing.amount).toBeCloseTo(0.4, 2);
  });

  it('6. measures a walkway clearance shortfall', () => {
    const k = room(floor, 'kitchen-living');
    const east = polygonBounds(k.polygon).maxX;
    // Sofa (0.90 deep) facing the east wall with 0.30 m between its front and the wall.
    const r = checkPlacement(
      floor,
      {
        catalogId: 'sofa-3',
        roomId: k.id,
        position: vec(east - 0.3 - 0.45, 4.2),
        rotation: Math.PI / 2,
        dimensions: getCatalogItem('sofa-3')!.dimensions,
      },
      C,
    );
    const walk = r.issues.find((i) => i.code === 'front-clearance')!;
    expect(walk).toMatchObject({ category: 'clearance', severity: 'soft' });
    expect(walk.amount).toBeCloseTo(0.3, 1); // needs 0.60 m, has 0.30 m
    expect(r.hard).toBe(false);
  });

  it('7. finds a fit that only exists after rotating the item', () => {
    // 3.0 × 1.2 m room; item 1.0 wide × 2.5 deep only fits turned 90°.
    const item = testBox(1.0, 2.5);
    const p = fitFurniture(boxFloor(3, 1.2), 'box', [{ catalogId: item.id }], C, {
      newId: testId,
      catalog: catalogWith(item),
    }).placements[0]!;
    expect(p.ok).toBe(true);
    const b = polygonBounds(furnitureFootprint(p.item!));
    expect(b.maxX - b.minX).toBeCloseTo(2.5);
    expect(b.maxZ - b.minZ).toBeCloseTo(1.0);
  });

  it('8. says when nothing fits in any orientation — and why, with measurements', () => {
    const item = testBox(1.5, 1.5);
    const tooBig = fitFurniture(boxFloor(3, 1.2), 'box', [{ catalogId: item.id }], C, {
      newId: testId,
      catalog: catalogWith(item),
    }).placements[0]!;
    expect(tooBig.failure).toBe('too-large');

    // Fits the bathroom's extents, but every pose hits the bath, WC, basin, walls or the door swing.
    const p = fitFurniture(floor, 'bathroom', [{ catalogId: 'bed-king' }], C, testId).placements[0]!;
    expect(p).toMatchObject({ ok: false, failure: 'no-valid-position' });
    expect(p.candidatesTried).toBeGreaterThan(0);
    expect(p.bestAttempt!.violations.some((v) => v.severity === 'hard' && (v.amount ?? 0) > 0)).toBe(true);
    const text = explainFit(p, 'King-size bed', 'Bathroom');
    expect(text).toMatch(/^Cannot place King-size bed in Bathroom\./);
    expect(text).toMatch(/Best candidate violated:\n- [a-z ]+ by \d\.\d\d m/);
  });

  it('9. respects L-shaped rooms (only fully-contained poses are accepted)', () => {
    const b2 = room(floor, 'bedroom-2');
    const { placements } = fitFurniture(
      floor,
      b2.id,
      [{ catalogId: 'bed-double' }, { catalogId: 'bedside-table' }, { catalogId: 'desk' }],
      C,
      testId,
    );
    for (const p of placements.filter((x) => x.ok)) {
      expect(polygonContainsPolygon(b2.polygon, furnitureFootprint(p.item!))).toBe(true);
    }
    expect(placements[0]!.ok).toBe(true);
    // A pose straddling the inner corner of the L is rejected and measured.
    const b = polygonBounds(b2.polygon);
    const straddle = checkPlacement(
      floor,
      {
        catalogId: 'plant',
        roomId: b2.id,
        position: vec(b.minX + 1.0, b.maxZ - 0.2),
        rotation: 0,
        dimensions: { width: 1.2, depth: 0.6, height: 1 },
      },
      C,
    );
    expect(codes(straddle.issues)).toContain('outside-room');
  });

  it('10. keeps clear of fixed fittings, including concave ones', () => {
    const { placements, floor: after } = fitFurniture(
      floor,
      'kitchen-living',
      [{ catalogId: 'dining-table-4' }, { catalogId: 'armchair' }],
      C,
      testId,
    );
    for (const p of placements) {
      expect(p.ok).toBe(true);
      for (const fx of after.fixtures)
        expect(polygonOverlapDepth(furnitureFootprint(p.item!), fx.footprint)).toBeLessThanOrEqual(
          C.tolerance,
        );
    }
    // Synthetic plan: an L-shaped counter. Its inner corner is free floor, its arms are not.
    const syn = buildApartment(SYNTHETIC_ANNOTATIONS).apartment.floors[0]!;
    const at = (px: number, py: number) => vec((px - 90) / 50, (py - 90) / 50);
    const probe = (p: Vec2) =>
      checkPlacement(
        syn,
        {
          catalogId: 'plant',
          roomId: 'living',
          position: p,
          rotation: 0,
          dimensions: { width: 0.4, depth: 0.4, height: 1 },
        },
        { ...C, blocking: [] },
      );
    expect(codes(probe(at(430, 180)).issues)).not.toContain('fixture-collision');
    expect(codes(probe(at(485, 180)).issues)).toContain('fixture-collision');
  });
});
