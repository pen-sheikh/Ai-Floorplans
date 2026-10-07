import { describe, expect, it } from 'vitest';
import {
  convexPolygonsOverlap,
  orientedRect,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonContainsPolygon,
  polygonDistance,
  polygonEdges,
  polygonSelfIntersects,
  rotateY,
  rotationFacing,
  signedArea,
  vec,
  wallFootprint,
  wallNormal,
} from './geometry';

const square = [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3)];
// L-shape: 4×3 with the top-right 2×1.5 removed.
const ell = [vec(0, 0), vec(2, 0), vec(2, 1.5), vec(4, 1.5), vec(4, 3), vec(0, 3)];

describe('polygon metrics', () => {
  it('computes area for rectangles and L-shapes regardless of winding', () => {
    expect(polygonArea(square)).toBeCloseTo(12);
    expect(polygonArea([...square].reverse())).toBeCloseTo(12);
    expect(polygonArea(ell)).toBeCloseTo(9);
    expect(Math.sign(signedArea(square))).toBe(-Math.sign(signedArea([...square].reverse())));
  });

  it('computes the centroid of an L-shaped room', () => {
    const c = polygonCentroid(ell);
    // Composite of 2×3 (centre 1, 1.5) and 2×1.5 (centre 3, 2.25).
    expect(c.x).toBeCloseTo((6 * 1 + 3 * 3) / 9);
    expect(c.z).toBeCloseTo((6 * 1.5 + 3 * 2.25) / 9);
  });

  it('detects self-intersection', () => {
    expect(polygonSelfIntersects(square)).toBe(false);
    expect(polygonSelfIntersects(ell)).toBe(false);
    expect(polygonSelfIntersects([vec(0, 0), vec(2, 2), vec(2, 0), vec(0, 2)])).toBe(true);
  });

  it('reports inward-facing edge normals for both windings', () => {
    for (const poly of [square, [...square].reverse()]) {
      for (const e of polygonEdges(poly)) {
        const mid = {
          x: (e.a.x + e.b.x) / 2 + e.inward.x * 0.01,
          z: (e.a.z + e.b.z) / 2 + e.inward.z * 0.01,
        };
        expect(pointInPolygon(mid, poly, 0)).toBe(true);
      }
    }
  });
});

describe('containment', () => {
  it('treats the notch of an L-shape as outside', () => {
    expect(pointInPolygon(vec(3, 0.5), ell)).toBe(false);
    expect(pointInPolygon(vec(1, 0.5), ell)).toBe(true);
    expect(polygonContainsPolygon(ell, orientedRect(vec(2, 2.25), 3.5, 1.2, 0))).toBe(true);
    // Straddles the inner corner of the L: corners may be inside, but an edge leaves the room.
    expect(polygonContainsPolygon(ell, orientedRect(vec(2.2, 1.4), 1.5, 1, 0))).toBe(false);
  });
});

describe('rotation convention (matches three.js rotation.y)', () => {
  it('rotates local +Z to (sin r, cos r) and +X to (cos r, −sin r)', () => {
    const f = rotateY(vec(0, 1), Math.PI / 2);
    expect(f.x).toBeCloseTo(1);
    expect(f.z).toBeCloseTo(0);
    const x = rotateY(vec(1, 0), Math.PI / 2);
    expect(x.x).toBeCloseTo(0);
    expect(x.z).toBeCloseTo(-1);
  });

  it('rotationFacing points local +Z along a direction', () => {
    for (const dir of [vec(1, 0), vec(0, -1), vec(-0.6, 0.8)]) {
      const f = rotateY(vec(0, 1), rotationFacing(dir));
      expect(f.x).toBeCloseTo(dir.x);
      expect(f.z).toBeCloseTo(dir.z);
    }
  });

  it('builds oriented rectangles with the right extents', () => {
    const r = orientedRect(vec(0, 0), 2, 1, Math.PI / 2);
    const xs = r.map((p) => p.x);
    const zs = r.map((p) => p.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2);
  });
});

describe('collision primitives', () => {
  it('SAT ignores touching shapes and detects penetration', () => {
    const a = orientedRect(vec(0, 0), 2, 2, 0);
    expect(convexPolygonsOverlap(a, orientedRect(vec(2, 0), 2, 2, 0))).toBe(false);
    expect(convexPolygonsOverlap(a, orientedRect(vec(1.9, 0), 2, 2, 0))).toBe(true);
    expect(convexPolygonsOverlap(a, orientedRect(vec(2.3, 0), 2, 2, Math.PI / 4))).toBe(true);
    expect(polygonDistance(a, orientedRect(vec(3, 0), 2, 2, 0))).toBeCloseTo(1);
  });

  it('derives the wall footprint and normal from the centreline', () => {
    const wall = { start: vec(0, 0), end: vec(4, 0), thickness: 0.2 };
    const n = wallNormal(wall);
    expect(n.x).toBeCloseTo(0);
    expect(n.z).toBeCloseTo(1);
    expect(polygonArea(wallFootprint(wall))).toBeCloseTo(0.8);
  });
});
