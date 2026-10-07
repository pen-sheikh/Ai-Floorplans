import { describe, expect, it } from 'vitest';
import { segmentRooms, simplifyPolygon, traceRegion } from './rooms';
import type { DetectedWall, Pt } from './walls';

const w = (id: string, a: Pt, b: Pt, thickness = 10): DetectedWall => ({
  id,
  a,
  b,
  thickness,
  ends: ['corner', 'corner'],
  coverage: 1,
  confidence: 1,
});
const area = (poly: Pt[]) =>
  Math.abs(
    poly.reduce(
      (s, p, i) => s + p.x * poly[(i + 1) % poly.length]!.y - poly[(i + 1) % poly.length]!.x * p.y,
      0,
    ),
  ) / 2;
const boxWalls = (x0: number, y0: number, x1: number, y1: number) => [
  w('t', { x: x0 - 5, y: y0 }, { x: x1 + 5, y: y0 }),
  w('r', { x: x1, y: y0 }, { x: x1, y: y1 }),
  w('b', { x: x0 - 5, y: y1 }, { x: x1 + 5, y: y1 }),
  w('l', { x: x0, y: y0 }, { x: x0, y: y1 }),
];

describe('segmentRooms', () => {
  it('turns closed walls into room polygons along the inner wall faces', () => {
    const seg = segmentRooms(boxWalls(40, 40, 360, 260), 400, 300, 10);
    expect(seg.rooms).toHaveLength(1);
    const r = seg.rooms[0]!;
    expect(r.polygon).toHaveLength(4);
    expect(area(r.polygon)).toBe(310 * 210);
    expect(seg.regionOf[0]).toBe(-1); // outside
    expect(seg.regionOf[150 * 400 + 200]).toBe(1); // inside room 1
    expect(seg.regionOf[40 * 400 + 200]).toBe(0); // on a wall
    expect(area(seg.footprint)).toBe(330 * 230); // outer faces
  });

  it('splits rooms at partitions and orders them top-to-bottom, left-to-right', () => {
    const seg = segmentRooms(
      [...boxWalls(40, 40, 360, 260), w('p', { x: 200, y: 40 }, { x: 200, y: 260 }, 6)],
      400,
      300,
      10,
    );
    expect(seg.rooms).toHaveLength(2);
    expect(seg.rooms[0]!.polygon.every((p) => p.x <= 197)).toBe(true);
    expect(area(seg.rooms[0]!.polygon) + area(seg.rooms[1]!.polygon)).toBe((152 + 152) * 210);
  });

  it('keeps concave (L-shaped) rooms exact', () => {
    // 300×200 box with a 100×100 block cut from the bottom-right corner by two walls.
    const seg = segmentRooms(
      [
        w('t', { x: 35, y: 40 }, { x: 345, y: 40 }),
        w('r', { x: 340, y: 40 }, { x: 340, y: 145 }),
        w('step', { x: 235, y: 140 }, { x: 345, y: 140 }),
        w('inner', { x: 240, y: 140 }, { x: 240, y: 245 }),
        w('b', { x: 35, y: 240 }, { x: 245, y: 240 }),
        w('l', { x: 40, y: 40 }, { x: 40, y: 240 }),
      ],
      400,
      300,
      10,
    );
    expect(seg.rooms).toHaveLength(1);
    const poly = seg.rooms[0]!.polygon;
    expect(poly).toHaveLength(6);
    expect(area(poly)).toBe(290 * 190 - 100 * 100);
  });

  it('drops slivers too narrow to be rooms', () => {
    const seg = segmentRooms(
      [...boxWalls(40, 40, 360, 260), w('p', { x: 52, y: 40 }, { x: 52, y: 260 }, 6)],
      400,
      300,
      10,
    );
    expect(seg.rooms).toHaveLength(1); // the 4 px strip between the walls is not a room
  });
});

describe('traceRegion / simplifyPolygon', () => {
  it('traces a pixel region along pixel edges', () => {
    const inside = (x: number, y: number) => x >= 2 && x < 22 && y >= 2 && y < 14 && !(x >= 14 && y >= 8);
    const poly = traceRegion(inside, { x0: 0, y0: 0, x1: 30, y1: 20 });
    expect(area(poly)).toBe(20 * 12 - 8 * 6);
    expect(poly).toHaveLength(6);
  });

  it('removes collinear and near-collinear vertices', () => {
    const poly = simplifyPolygon(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0.2 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      0.5,
    );
    expect(poly).toHaveLength(4);
  });
});
