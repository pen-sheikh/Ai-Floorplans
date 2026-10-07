import {
  add,
  distance,
  pointSegmentDistance,
  polygonCentroid,
  rotateY,
  scale,
  sub,
} from '../../domain/geometry';
import type { Vec2 } from '../../domain/types';

export interface FixtureFrame {
  center: Vec2;
  /** Local X extent. */
  width: number;
  /** Local Z extent; local −Z (the back) faces the nearest room boundary. */
  depth: number;
  rotation: number;
}

/**
 * Orient a rectangular fixture footprint so its back is against the closest wall — so a WC's
 * cistern or a basin's tap end goes to the wall without hard-coding per-plan orientation.
 */
export function fixtureFrame(footprint: readonly Vec2[], roomPolygon: readonly Vec2[] | null): FixtureFrame {
  const [p0, p1, , p3] = footprint as [Vec2, Vec2, Vec2, Vec2];
  const center = polygonCentroid(footprint);
  const a = distance(p0, p1);
  const b = distance(p0, p3);
  const e = sub(p1, p0);
  const base = Math.atan2(-e.z, e.x);
  const options = [0, 1, 2, 3].map((k) => {
    const rotation = base + (k * Math.PI) / 2;
    const [width, depth] = k % 2 === 0 ? [a, b] : [b, a];
    return { center, width, depth, rotation };
  });
  if (!roomPolygon) return options[0]!;
  const boundaryDistance = (p: Vec2) =>
    Math.min(
      ...roomPolygon.map((q, i) => pointSegmentDistance(p, q, roomPolygon[(i + 1) % roomPolygon.length]!)),
    );
  return options.reduce((best, o) => {
    const back = add(center, scale(rotateY({ x: 0, z: -1 }, o.rotation), o.depth / 2));
    const bestBack = add(center, scale(rotateY({ x: 0, z: -1 }, best.rotation), best.depth / 2));
    return boundaryDistance(back) < boundaryDistance(bestBack) - 1e-6 ? o : best;
  });
}
