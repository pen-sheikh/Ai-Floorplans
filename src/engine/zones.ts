import { pointAlongWall } from '../domain/geometry';
import type { Door, Floor, Vec2, Wall, Window } from '../domain/types';
import type { PlacementConstraints, PlacementIssueCode } from './constraints';

/**
 * Functional zones: areas of the floor that must stay usable. Each zone says which issue it
 * raises when furniture enters it. New kinds (kitchen work zone, bedside access, wardrobe door
 * swing…) are added by producing more zones — the placement check does not change.
 */
export interface FunctionalZone {
  id: string;
  kind: 'door-swing' | 'door-access' | 'window-access';
  polygon: Vec2[];
  issue: PlacementIssueCode;
  /** Entity the zone belongs to (door/window id). */
  sourceId: string;
  /** Human label, e.g. "entrance door". */
  label: string;
  /** Only items taller than this (top above floor) violate the zone, e.g. a window sill. */
  minItemTop?: number;
}

/** Rectangle on one side of a wall over [from, to] along it, from the face out to `depth`. */
export function wallSideRect(wall: Wall, from: number, to: number, side: 1 | -1, depth: number): Vec2[] {
  const near = (side * wall.thickness) / 2;
  const far = side * (wall.thickness / 2 + depth);
  return [
    pointAlongWall(wall, from, near),
    pointAlongWall(wall, to, near),
    pointAlongWall(wall, to, far),
    pointAlongWall(wall, from, far),
  ];
}

export interface DoorZones {
  doorId: string;
  /** Area swept by the leaf/leaves (absent for sliding doors and plain openings). */
  swing: Vec2[] | null;
  /** Access zones on both sides. */
  clearance: Vec2[][];
}

export function doorZones(door: Door, wall: Wall, c: Pick<PlacementConstraints, 'doorClearance'>): DoorZones {
  const from = door.offset - door.width / 2;
  const to = door.offset + door.width / 2;
  const sweep: Partial<Record<Door['kind'], number>> = {
    hinged: door.width,
    double: door.width / 2,
    bifold: door.width / 2,
  };
  const depth = sweep[door.kind];
  return {
    doorId: door.id,
    swing: depth ? wallSideRect(wall, from, to, door.swingSide, depth) : null,
    clearance: [
      wallSideRect(wall, from, to, 1, c.doorClearance),
      wallSideRect(wall, from, to, -1, c.doorClearance),
    ],
  };
}

export function windowZones(
  win: Window,
  wall: Wall,
  c: Pick<PlacementConstraints, 'windowClearance'>,
): Vec2[][] {
  const from = win.offset - win.width / 2;
  const to = win.offset + win.width / 2;
  return [
    wallSideRect(wall, from, to, 1, c.windowClearance),
    wallSideRect(wall, from, to, -1, c.windowClearance),
  ];
}

type ZoneInputs = Pick<Floor, 'walls' | 'doors' | 'windows'>;
type ZoneConstraints = Pick<PlacementConstraints, 'doorClearance' | 'windowClearance' | 'respectDoorSwings'>;

/** All functional zones of a floor. */
export function functionalZones(floor: ZoneInputs, c: ZoneConstraints): FunctionalZone[] {
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));
  const zones: FunctionalZone[] = [];
  for (const door of floor.doors) {
    const wall = wallById.get(door.wallId);
    if (!wall) continue;
    const z = doorZones(door, wall, c);
    const label = (door.note ?? (door.kind === 'opening' ? 'opening' : 'door')).toLowerCase();
    if (c.respectDoorSwings && z.swing) {
      zones.push({
        id: `${door.id}:swing`,
        kind: 'door-swing',
        polygon: z.swing,
        issue: 'door-swing',
        sourceId: door.id,
        label,
      });
    }
    z.clearance.forEach((polygon, i) =>
      zones.push({
        id: `${door.id}:access${i}`,
        kind: 'door-access',
        polygon,
        issue: 'door-clearance',
        sourceId: door.id,
        label,
      }),
    );
  }
  for (const win of floor.windows) {
    const wall = wallById.get(win.wallId);
    if (!wall) continue;
    windowZones(win, wall, c).forEach((polygon, i) =>
      zones.push({
        id: `${win.id}:access${i}`,
        kind: 'window-access',
        polygon,
        issue: 'window-blocked',
        sourceId: win.id,
        label: 'window',
        minItemTop: win.sillHeight,
      }),
    );
  }
  return zones;
}

// Zones depend only on walls/doors/windows and constraints. Furniture edits keep those arrays
// referentially identical, so this cache makes zone lookup free during drags and fitting.
interface ZoneCacheEntry {
  key: string;
  walls: unknown;
  windows: unknown;
  zones: FunctionalZone[];
}
const zoneCache = new WeakMap<object, ZoneCacheEntry>();

export function cachedFunctionalZones(floor: ZoneInputs, c: ZoneConstraints): FunctionalZone[] {
  const key = `${c.doorClearance}|${c.windowClearance}|${c.respectDoorSwings}`;
  const entry = zoneCache.get(floor.doors);
  if (entry && entry.key === key && entry.walls === floor.walls && entry.windows === floor.windows)
    return entry.zones;
  const zones = functionalZones(floor, c);
  zoneCache.set(floor.doors, { key, walls: floor.walls, windows: floor.windows, zones });
  return zones;
}
