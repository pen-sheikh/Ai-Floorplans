import type { Vec2, Wall } from './types';

/** Geometric tolerance in metres (0.5 mm). */
export const EPS = 5e-4;

export const vec = (x: number, z: number): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
/** 2D cross product (z-component of the 3D cross of (x, z) vectors in the plan frame). */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.z - a.z * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.z);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l < 1e-12 ? { x: 0, z: 0 } : { x: a.x / l, z: a.z / l };
}

/**
 * Rotate a vector about +Y by `angle` radians using the three.js convention, so
 * rotating local +Z by r gives (sin r, cos r) and local +X gives (cos r, −sin r).
 */
export function rotateY(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c + v.z * s, z: -v.x * s + v.z * c };
}

/** Rotation about +Y that points local +Z along `dir`. */
export function rotationFacing(dir: Vec2): number {
  return Math.atan2(dir.x, dir.z);
}

/** Shoelace signed area; positive when vertices run from +X towards +Z. */
export function signedArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export const polygonArea = (poly: readonly Vec2[]): number => Math.abs(signedArea(poly));

export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-12) {
    const s = poly.reduce((acc, p) => add(acc, p), vec(0, 0));
    return scale(s, 1 / Math.max(poly.length, 1));
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function polygonBounds(poly: readonly Vec2[]): Bounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minZ, maxX, maxZ };
}

export function polygonPerimeter(poly: readonly Vec2[]): number {
  let p = 0;
  for (let i = 0; i < poly.length; i++) p += distance(poly[i]!, poly[(i + 1) % poly.length]!);
  return p;
}

/** Distance from point p to segment ab. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-18) return distance(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return distance(p, add(a, scale(ab, t)));
}

export function pointOnPolygonBoundary(p: Vec2, poly: readonly Vec2[], tol = EPS): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!) <= tol) return true;
  }
  return false;
}

/** Even-odd point-in-polygon. Points on the boundary are reported as inside. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[], tol = EPS): boolean {
  if (pointOnPolygonBoundary(p, poly, tol)) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Strictly-inside test (boundary counts as outside). */
export function pointStrictlyInPolygon(p: Vec2, poly: readonly Vec2[], tol = EPS): boolean {
  return !pointOnPolygonBoundary(p, poly, tol) && pointInPolygon(p, poly, 0);
}

/**
 * Proper intersection of segments ab and cd: they cross at a single interior point.
 * Touching at endpoints or collinear overlap is not a proper intersection.
 */
export function segmentsProperlyIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tol = 1e-9): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < -tol && d3 * d4 < -tol;
}

/** True if any two non-adjacent edges of the polygon cross. */
export function polygonSelfIntersects(poly: readonly Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsProperlyIntersect(a, b, poly[j]!, poly[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/** Corners of a rectangle centred at `center`, rotated about +Y. Local width on X, depth on Z. */
export function orientedRect(center: Vec2, width: number, depth: number, rotation: number): Vec2[] {
  const hw = width / 2;
  const hd = depth / 2;
  const local: Vec2[] = [vec(-hw, -hd), vec(hw, -hd), vec(hw, hd), vec(-hw, hd)];
  return local.map((p) => add(center, rotateY(p, rotation)));
}

export function wallDirection(wall: Pick<Wall, 'start' | 'end'>): Vec2 {
  return normalize(sub(wall.end, wall.start));
}

/** Wall normal n = (−d.z, d.x). Side +1 of a wall is the half-plane n points into. */
export function wallNormal(wall: Pick<Wall, 'start' | 'end'>): Vec2 {
  const d = wallDirection(wall);
  return { x: -d.z, z: d.x };
}

export const wallLength = (wall: Pick<Wall, 'start' | 'end'>): number => distance(wall.start, wall.end);

/** Point on the wall centreline `offset` metres from start, pushed `side` metres along the normal. */
export function pointAlongWall(wall: Pick<Wall, 'start' | 'end'>, offset: number, side = 0): Vec2 {
  const d = wallDirection(wall);
  const n = wallNormal(wall);
  return add(add(wall.start, scale(d, offset)), scale(n, side));
}

/** The wall's solid footprint as a 4-corner polygon. */
export function wallFootprint(wall: Pick<Wall, 'start' | 'end' | 'thickness'>): Vec2[] {
  const n = wallNormal(wall);
  const h = wall.thickness / 2;
  return [
    add(wall.start, scale(n, -h)),
    add(wall.end, scale(n, -h)),
    add(wall.end, scale(n, h)),
    add(wall.start, scale(n, h)),
  ];
}

function projectPolygon(poly: readonly Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const v = dot(p, axis);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return [min, max];
}

/**
 * Separating-axis overlap depth for two convex polygons. Returns the minimum penetration
 * along any edge normal (≤ 0 means separated or merely touching).
 */
export function convexOverlapDepth(a: readonly Vec2[], b: readonly Vec2[]): number {
  let minOverlap = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const axis = normalize({ x: -(q.z - p.z), z: q.x - p.x });
      if (axis.x === 0 && axis.z === 0) continue;
      const [amin, amax] = projectPolygon(a, axis);
      const [bmin, bmax] = projectPolygon(b, axis);
      const overlap = Math.min(amax, bmax) - Math.max(amin, bmin);
      if (overlap <= 0) return overlap;
      minOverlap = Math.min(minOverlap, overlap);
    }
  }
  return minOverlap;
}

/** True if two convex polygons overlap by more than `tol` metres. */
export function convexPolygonsOverlap(a: readonly Vec2[], b: readonly Vec2[], tol = EPS): boolean {
  return convexOverlapDepth(a, b) > tol;
}

/** Minimum distance between two non-overlapping polygons (0 if they overlap). */
export function polygonDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (convexOverlapDepth(a, b) > 0) return 0;
  let best = Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const v of p) {
      for (let i = 0; i < q.length; i++) {
        best = Math.min(best, pointSegmentDistance(v, q[i]!, q[(i + 1) % q.length]!));
      }
    }
  }
  return best;
}

/**
 * True if `inner` lies inside the (possibly concave) polygon `outer`: every vertex is inside
 * (boundary allowed) and no edge of `inner` properly crosses an edge of `outer`.
 */
export function polygonContainsPolygon(outer: readonly Vec2[], inner: readonly Vec2[], tol = EPS): boolean {
  if (!inner.every((p) => pointInPolygon(p, outer, tol))) return false;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i]!;
    const b = inner[(i + 1) % inner.length]!;
    for (let j = 0; j < outer.length; j++) {
      if (segmentsProperlyIntersect(a, b, outer[j]!, outer[(j + 1) % outer.length]!)) return false;
    }
    // A chord between two boundary points can still leave a concave polygon.
    if (!pointInPolygon(scale(add(a, b), 0.5), outer, tol)) return false;
  }
  return true;
}

/**
 * Approximate overlap area of two simple polygons by sampling a grid over the smaller
 * polygon's bounds. Adequate for validation (detecting rooms that overlap noticeably).
 */
export function approximateOverlapArea(a: readonly Vec2[], b: readonly Vec2[], cell = 0.05): number {
  const ba = polygonBounds(a);
  const bb = polygonBounds(b);
  const minX = Math.max(ba.minX, bb.minX);
  const maxX = Math.min(ba.maxX, bb.maxX);
  const minZ = Math.max(ba.minZ, bb.minZ);
  const maxZ = Math.min(ba.maxZ, bb.maxZ);
  if (minX >= maxX || minZ >= maxZ) return 0;
  let count = 0;
  for (let x = minX + cell / 2; x < maxX; x += cell) {
    for (let z = minZ + cell / 2; z < maxZ; z += cell) {
      const p = vec(x, z);
      if (pointStrictlyInPolygon(p, a) && pointStrictlyInPolygon(p, b)) count++;
    }
  }
  return count * cell * cell;
}

/** Edges of a polygon with their inward-facing unit normals. */
export function polygonEdges(poly: readonly Vec2[]): { a: Vec2; b: Vec2; length: number; inward: Vec2 }[] {
  const ccw = signedArea(poly) > 0;
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const d = normalize(sub(b, a));
    // For positive signed area (x→z winding) the interior lies on the (−d.z, d.x) side.
    const left = { x: -d.z, z: d.x };
    return { a, b, length: distance(a, b), inward: ccw ? left : scale(left, -1) };
  });
}
