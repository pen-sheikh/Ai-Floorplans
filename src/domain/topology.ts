import {
  pointAlongWall,
  pointStrictlyInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  wallLength,
} from './geometry';
import type { Apartment, Door, Floor, Room, Vec2, Wall, Window } from './types';

const boundsCache = new WeakMap<readonly Vec2[], ReturnType<typeof polygonBounds>>();
const boundsOf = (poly: readonly Vec2[]) => {
  let b = boundsCache.get(poly);
  if (!b) boundsCache.set(poly, (b = polygonBounds(poly)));
  return b;
};

/** Room whose interior contains the point (boundary excluded), or null. */
export function roomAt(floor: Pick<Floor, 'rooms'>, p: Vec2): Room | null {
  return (
    floor.rooms.find((r) => {
      const b = boundsOf(r.polygon);
      return (
        p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && pointStrictlyInPolygon(p, r.polygon)
      );
    }) ?? null
  );
}

/** Probe distance beyond the wall face used to find the room on each side. */
const SIDE_PROBE = 0.08;

/** Rooms on the −n / +n side of a wall at a given offset along it. */
export function roomsBesideWall(
  floor: Pick<Floor, 'rooms'>,
  wall: Wall,
  offset: number,
): [Room | null, Room | null] {
  const d = wall.thickness / 2 + SIDE_PROBE;
  return [roomAt(floor, pointAlongWall(wall, offset, -d)), roomAt(floor, pointAlongWall(wall, offset, d))];
}

/** All rooms touching either face of the wall, sampled every ~10 cm. */
export function roomsAlongWall(floor: Pick<Floor, 'rooms'>, wall: Wall): Set<string> {
  const ids = new Set<string>();
  const len = wallLength(wall);
  // Every ~10 cm, but never more than a few hundred probes (bounds the cost on huge walls).
  const steps = Math.min(400, Math.max(2, Math.ceil(len / 0.1)));
  for (let i = 0; i <= steps; i++) {
    for (const r of roomsBesideWall(floor, wall, (len * i) / steps)) if (r) ids.add(r.id);
  }
  return ids;
}

/** Recompute Room.wallIds/doorIds/windowIds and Door.connects from geometry. */
export function deriveTopology(floor: Floor): Floor {
  const wallRooms = new Map(floor.walls.map((w) => [w.id, roomsAlongWall(floor, w)]));
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));

  const doors: Door[] = floor.doors.map((door) => {
    const wall = wallById.get(door.wallId);
    if (!wall) return door;
    const [a, b] = roomsBesideWall(floor, wall, door.offset);
    return { ...door, connects: [a?.id ?? null, b?.id ?? null] };
  });

  const windowRooms = (win: Window): string[] => {
    const wall = wallById.get(win.wallId);
    if (!wall) return [];
    return roomsBesideWall(floor, wall, win.offset)
      .filter((r): r is Room => r !== null)
      .map((r) => r.id);
  };

  const rooms = floor.rooms.map((room) => ({
    ...room,
    wallIds: floor.walls.filter((w) => wallRooms.get(w.id)?.has(room.id)).map((w) => w.id),
    doorIds: doors.filter((d) => d.connects.includes(room.id)).map((d) => d.id),
    windowIds: floor.windows.filter((w) => windowRooms(w).includes(room.id)).map((w) => w.id),
  }));

  return { ...floor, rooms, doors };
}

export interface RoomMetrics {
  area: number;
  centroid: Vec2;
  /** Axis-aligned extents of the footprint. */
  width: number;
  depth: number;
  perimeter: number;
}

export function roomMetrics(room: Pick<Room, 'polygon'>): RoomMetrics {
  const b = polygonBounds(room.polygon);
  let perimeter = 0;
  for (let i = 0; i < room.polygon.length; i++) {
    const p = room.polygon[i]!;
    const q = room.polygon[(i + 1) % room.polygon.length]!;
    perimeter += Math.hypot(q.x - p.x, q.z - p.z);
  }
  return {
    area: polygonArea(room.polygon),
    centroid: polygonCentroid(room.polygon),
    width: b.maxX - b.minX,
    depth: b.maxZ - b.minZ,
    perimeter,
  };
}

// ── Lookups ────────────────────────────────────────────────────────────────────────

export function findFloorOf(apartment: Apartment, predicate: (f: Floor) => boolean): Floor | undefined {
  return apartment.floors.find(predicate);
}

export const findRoom = (apt: Apartment, id: string): Room | undefined =>
  apt.floors.flatMap((f) => f.rooms).find((r) => r.id === id);

export const findWall = (apt: Apartment, id: string): Wall | undefined =>
  apt.floors.flatMap((f) => f.walls).find((w) => w.id === id);

export const findDoor = (apt: Apartment, id: string): Door | undefined =>
  apt.floors.flatMap((f) => f.doors).find((d) => d.id === id);

export const findWindow = (apt: Apartment, id: string): Window | undefined =>
  apt.floors.flatMap((f) => f.windows).find((w) => w.id === id);

export const floorOfRoom = (apt: Apartment, roomId: string): Floor | undefined =>
  apt.floors.find((f) => f.rooms.some((r) => r.id === roomId));

/** Find a room by id, exact name, or loose name/type match (used by the intent layer). */
export function resolveRoom(apt: Apartment, query: string): Room | undefined {
  const rooms = apt.floors.flatMap((f) => f.rooms);
  const q = query.trim().toLowerCase();
  return (
    rooms.find((r) => r.id === q) ??
    rooms.find((r) => r.name.toLowerCase() === q) ??
    rooms.find((r) => r.name.toLowerCase().includes(q) || q.includes(r.name.toLowerCase()))
  );
}
