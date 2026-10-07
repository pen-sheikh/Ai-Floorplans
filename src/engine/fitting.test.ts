import { describe, expect, it } from 'vitest';
import { add, pointSegmentDistance, polygonEdges, rotateY, scale } from '../domain/geometry';
import type { FurnitureItem } from '../domain/types';
import { e2Floor, room, testId } from '../test/fixtures';
import { DEFAULT_CONSTRAINTS, type PlacementConstraints } from './constraints';
import { fitFurniture } from './fitting';
import { checkPlacement } from './placement';

const C: PlacementConstraints = { ...DEFAULT_CONSTRAINTS, blocking: [...DEFAULT_CONSTRAINTS.blocking] };

const backPoint = (f: FurnitureItem) =>
  add(f.position, scale(rotateY({ x: 0, z: -1 }, f.rotation), f.dimensions.depth / 2));

describe('fitFurniture', () => {
  const floor = e2Floor();

  it('puts a 3-seat sofa with its back against the longest wall of the living room', () => {
    const { placements } = fitFurniture(
      floor,
      'kitchen-living',
      [{ catalogId: 'sofa-3', preferWall: 'longest' }],
      C,
      testId,
    );
    const p = placements[0]!;
    expect(p.ok).toBe(true);
    const edges = polygonEdges(room(floor, 'kitchen-living').polygon);
    const longest = edges.reduce((m, e) => (e.length > m.length ? e : m));
    expect(longest.length).toBeCloseTo(6.39, 1);
    expect(pointSegmentDistance(backPoint(p.item!), longest.a, longest.b)).toBeLessThan(0.05);
  });

  it('places several items without collisions, each passing the same placement check', () => {
    const { placements, floor: after } = fitFurniture(
      floor,
      'kitchen-living',
      [
        { catalogId: 'sofa-3' },
        { catalogId: 'tv-unit' },
        { catalogId: 'coffee-table' },
        { catalogId: 'dining-table-4' },
      ],
      C,
      testId,
    );
    expect(placements.every((p) => p.ok)).toBe(true);
    for (const item of after.furniture) {
      const r = checkPlacement(after, item, C);
      expect(r.hard).toBe(false);
      expect(r.roomId).toBe('kitchen-living');
    }
  });

  it('answers "can a king-size bed fit in Bedroom 1?" with yes', () => {
    const { placements } = fitFurniture(floor, 'bedroom-1', [{ catalogId: 'bed-king' }], C, testId);
    expect(placements[0]!.ok).toBe(true);
  });

  it('says no — with a reason — when an item cannot fit', () => {
    const { placements } = fitFurniture(floor, 'bathroom', [{ catalogId: 'bed-king' }], C, testId);
    expect(placements[0]!.ok).toBe(false);
    expect(placements[0]!.reason).toMatch(/No position in Bathroom/);
    const unknown = fitFurniture(floor, 'bathroom', [{ catalogId: 'spaceship' }], C, testId);
    expect(unknown.placements[0]!.reason).toMatch(/Unknown furniture/);
  });

  it('respects configurable clearances (stricter rules leave less room)', () => {
    const big = fitFurniture(
      floor,
      'bedroom-2',
      [{ catalogId: 'bed-king' }, { catalogId: 'wardrobe' }, { catalogId: 'desk' }],
      C,
      testId,
    );
    const strict = { ...C, walkingClearance: 1.4, doorClearance: 1.5 };
    const tight = fitFurniture(
      floor,
      'bedroom-2',
      [{ catalogId: 'bed-king' }, { catalogId: 'wardrobe' }, { catalogId: 'desk' }],
      strict,
      testId,
    );
    const softCount = (r: typeof big) => r.placements.reduce((n, p) => n + p.issues.length, 0);
    expect(softCount(tight)).toBeGreaterThanOrEqual(softCount(big));
  });

  it('is deterministic', () => {
    let i = 0;
    const ids = () => `x${++i}`;
    const a = fitFurniture(
      floor,
      'kitchen-living',
      [{ catalogId: 'sofa-3' }, { catalogId: 'coffee-table' }],
      C,
      ids,
    );
    i = 0;
    const b = fitFurniture(
      floor,
      'kitchen-living',
      [{ catalogId: 'sofa-3' }, { catalogId: 'coffee-table' }],
      C,
      ids,
    );
    expect(a.placements).toEqual(b.placements);
  });

  it('puts the coffee table in front of the sofa', () => {
    const { placements } = fitFurniture(
      floor,
      'kitchen-living',
      [{ catalogId: 'sofa-3' }, { catalogId: 'coffee-table' }],
      C,
      testId,
    );
    const [sofa, table] = placements.map((p) => p.item!);
    const front = rotateY({ x: 0, z: 1 }, sofa!.rotation);
    const rel = { x: table!.position.x - sofa!.position.x, z: table!.position.z - sofa!.position.z };
    expect(rel.x * front.x + rel.z * front.z).toBeGreaterThan(0.5);
  });
});
