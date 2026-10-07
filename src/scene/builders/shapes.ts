import * as THREE from 'three';
import type { Vec2 } from '../../domain/types';

/**
 * Floor-plane polygon → flat geometry.
 *  - 'up' (floors): build the shape in (x, −z) and rotate −90° about X → faces +Y.
 *  - 'down' (ceilings): build in (x, z) and rotate +90° about X → faces −Y, so ceilings are
 *    back-face culled (invisible) when seen from above and visible from inside a room.
 * UVs equal plan metres, so pattern textures keep real-world scale.
 */
export function polygonGeometry(polygon: readonly Vec2[], facing: 'up' | 'down'): THREE.ShapeGeometry {
  const sign = facing === 'up' ? -1 : 1;
  const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x, sign * p.z)));
  return new THREE.ShapeGeometry(shape);
}

export const polygonRotationX = (facing: 'up' | 'down'): number =>
  facing === 'up' ? -Math.PI / 2 : Math.PI / 2;

/** Flat list of segment endpoints for a closed polygon at height y (for LineSegments). */
export function polygonOutline(polygon: readonly Vec2[], y: number): number[] {
  const out: number[] = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    out.push(p.x, y, p.z, q.x, y, q.z);
  });
  return out;
}
