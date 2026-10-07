import { pointInPolygon, polygonArea, polygonBounds, polygonCentroid } from '../../domain/geometry';
import type { Floor, Vec2 } from '../../domain/types';

export type Vec3Tuple = [number, number, number];

export interface CameraPose {
  position: Vec3Tuple;
  target: Vec3Tuple;
}

export type PoseMode = 'perspective' | 'top' | 'room' | 'exterior';

const EYE_HEIGHT = 1.6;

export function floorBounds(floor: Pick<Floor, 'footprint' | 'rooms'>) {
  const pts: Vec2[] = [...floor.footprint, ...floor.rooms.flatMap((r) => r.polygon)];
  const b = polygonBounds(pts);
  const center = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 1);
  return { ...b, center, size };
}

/**
 * Camera poses derived from the model. The plan's "up" (−Z) stays at the top of the screen
 * for perspective and top views so the 3D view reads like the 2D plan.
 */
export function cameraPose(
  mode: PoseMode,
  floor: Pick<Floor, 'footprint' | 'rooms'>,
  roomId?: string,
  fovDeg = 42,
  aspect = 1.5,
  /** Footprints to avoid standing in (furniture, fixtures). */
  obstacles: readonly (readonly Vec2[])[] = [],
): CameraPose {
  const { center: c, size } = floorBounds(floor);
  // Narrow viewports see less horizontally, so back off to keep the whole unit in frame.
  const s = size * Math.max(1, 1.25 / aspect);
  switch (mode) {
    case 'top': {
      const h = (s / 2 / Math.tan(((fovDeg / 2) * Math.PI) / 180)) * 1.12;
      return { position: [c.x, h, c.z + 0.001], target: [c.x, 0, c.z] };
    }
    case 'exterior':
      return { position: [c.x - s * 0.85, s * 0.75, c.z + s * 1.15], target: [c.x, 0.8, c.z] };
    case 'room': {
      const room = floor.rooms.find((r) => r.id === roomId);
      if (room) return roomPose(room.polygon, obstacles);
      return cameraPose('perspective', floor, undefined, fovDeg, aspect);
    }
    case 'perspective':
    default:
      return { position: [c.x + s * 0.18, s * 0.95, c.z + s * 0.95], target: [c.x, 0, c.z] };
  }
}

/**
 * Stand inside the room near a far corner, looking across it at eye height. Corners whose
 * standing point is inside furniture or fixtures are skipped.
 */
export function roomPose(polygon: readonly Vec2[], obstacles: readonly (readonly Vec2[])[] = []): CameraPose {
  const c = polygonCentroid(polygon);
  const area = polygonArea(polygon);
  if (area < 2.5) {
    // Too small to stand in (cupboards): look in from above at an angle.
    return { position: [c.x, 2.9, c.z + 1.6], target: [c.x, 0.3, c.z] };
  }
  const byDistance = [...polygon].sort(
    (a, b) => Math.hypot(b.x - c.x, b.z - c.z) - Math.hypot(a.x - c.x, a.z - c.z),
  );
  const free = (p: Vec2) => pointInPolygon(p, polygon) && !obstacles.some((o) => pointInPolygon(p, o));
  const candidates = byDistance.flatMap((v) =>
    [0.65, 0.5, 0.35].map((k) => ({ x: c.x + (v.x - c.x) * k, z: c.z + (v.z - c.z) * k })),
  );
  for (const p of candidates) {
    if (free(p)) {
      return {
        position: [p.x, EYE_HEIGHT, p.z],
        target: [c.x - (p.x - c.x) * 0.4, 1.1, c.z - (p.z - c.z) * 0.4],
      };
    }
  }
  return { position: [c.x, EYE_HEIGHT, c.z + 0.5], target: [c.x, 1.1, c.z - 1] };
}
