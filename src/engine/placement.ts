import { getCatalogItem } from '../catalog/furnitureCatalog';
import {
  add,
  convexOverlapDepth,
  orientedRect,
  pointAlongWall,
  polygonContainsPolygon,
  rotateY,
  scale,
  wallFootprint,
} from '../domain/geometry';
import type { Dimensions3, Door, Floor, FurnitureItem, Room, Vec2, Wall, Window } from '../domain/types';
import { ISSUE_SEVERITY, type PlacementConstraints, type PlacementIssueCode } from './constraints';

export interface PlacementIssue {
  code: PlacementIssueCode;
  severity: 'hard' | 'soft';
  message: string;
  /** The wall/door/fixture/furniture involved, if any. */
  otherId?: string;
}

/** What is being placed: an existing item or a draft from the catalog. */
export interface PlacementSubject {
  id?: string;
  catalogId: string;
  name?: string;
  roomId: string;
  position: Vec2;
  rotation: number;
  dimensions: Dimensions3;
  elevation?: number;
}

export interface PlacementReport {
  /** Room that fully contains the footprint (may differ from subject.roomId after a move). */
  roomId: string | null;
  footprint: Vec2[];
  issues: PlacementIssue[];
  /** Any hard issue. */
  hard: boolean;
  /** Any issue listed in constraints.blocking. */
  blocked: boolean;
}

export const furnitureFootprint = (
  item: Pick<FurnitureItem, 'position' | 'dimensions' | 'rotation'>,
): Vec2[] => orientedRect(item.position, item.dimensions.width, item.dimensions.depth, item.rotation);

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

/** Free zone the item needs in front of it (local +Z), or null if it needs none. */
export function frontClearanceZone(
  subject: PlacementSubject,
  c: Pick<PlacementConstraints, 'walkingClearance'>,
): Vec2[] | null {
  const rules = getCatalogItem(subject.catalogId)?.placement;
  if (!rules || rules.frontClearance <= 0) return null;
  const depth = Math.max(rules.frontClearance, c.walkingClearance);
  const front = rotateY({ x: 0, z: 1 }, subject.rotation);
  const center = add(subject.position, scale(front, subject.dimensions.depth / 2 + depth / 2));
  return orientedRect(center, subject.dimensions.width, depth, subject.rotation);
}

const collides = (catalogId: string): boolean => getCatalogItem(catalogId)?.placement.collides ?? true;

/**
 * Check a placement against the room boundary, walls, fixtures, other furniture, door swings
 * and clearances. Pure and deterministic — the same function serves drag-and-drop,
 * automated fitting and AI-suggested placements.
 */
export function checkPlacement(
  floor: Floor,
  subject: PlacementSubject,
  c: PlacementConstraints,
  options: { ignoreIds?: ReadonlySet<string> } = {},
): PlacementReport {
  const issues: PlacementIssue[] = [];
  const push = (code: PlacementIssueCode, message: string, otherId?: string) =>
    issues.push({ code, severity: ISSUE_SEVERITY[code], message, ...(otherId ? { otherId } : {}) });
  const label = subject.name ?? getCatalogItem(subject.catalogId)?.name ?? 'Item';
  const fp = orientedRect(
    subject.position,
    subject.dimensions.width,
    subject.dimensions.depth,
    subject.rotation,
  );
  const hits = (poly: Vec2[]) => convexOverlapDepth(fp, poly) > c.tolerance;

  // Room containment: the item's own room first, then any room (moved through a doorway).
  const ordered: Room[] = [
    ...floor.rooms.filter((r) => r.id === subject.roomId),
    ...floor.rooms.filter((r) => r.id !== subject.roomId),
  ];
  const room = ordered.find((r) => polygonContainsPolygon(r.polygon, fp, c.tolerance)) ?? null;
  if (!room) {
    const home = floor.rooms.find((r) => r.id === subject.roomId);
    push('outside-room', `${label} extends outside ${home?.name ?? 'the room'}.`, subject.roomId);
  }

  for (const wall of floor.walls) {
    if (hits(wallFootprint(wall))) push('wall-collision', `${label} intersects a wall.`, wall.id);
  }

  for (const fx of floor.fixtures) {
    if (hits(fx.footprint))
      push('fixture-collision', `${label} intersects the ${fx.label.toLowerCase()}.`, fx.id);
  }

  const ignore = options.ignoreIds ?? new Set<string>();
  const others = floor.furniture.filter((f) => f.id !== subject.id && !ignore.has(f.id));
  if (collides(subject.catalogId)) {
    for (const other of others) {
      if (!collides(other.catalogId)) continue;
      if (hits(furnitureFootprint(other)))
        push('furniture-collision', `${label} overlaps the ${other.name.toLowerCase()}.`, other.id);
    }
  }

  // Doors and windows only matter for items that physically block (not rugs).
  if (collides(subject.catalogId)) {
    const wallById = new Map(floor.walls.map((w) => [w.id, w]));
    for (const door of floor.doors) {
      const wall = wallById.get(door.wallId);
      if (!wall) continue;
      const z = doorZones(door, wall, c);
      const name = door.note ?? (door.kind === 'opening' ? 'opening' : 'door');
      if (c.respectDoorSwings && z.swing && hits(z.swing)) {
        push('door-swing', `${label} blocks the swing of the ${name.toLowerCase()}.`, door.id);
      } else if (z.clearance.some(hits)) {
        push(
          'door-clearance',
          `${label} is within ${c.doorClearance.toFixed(2)} m of the ${name.toLowerCase()}.`,
          door.id,
        );
      }
    }
    const top = (subject.elevation ?? 0) + subject.dimensions.height;
    for (const win of floor.windows) {
      const wall = wallById.get(win.wallId);
      if (!wall || top <= win.sillHeight) continue;
      if (windowZones(win, wall, c).some(hits))
        push('window-blocked', `${label} is taller than the sill and blocks a window.`, win.id);
    }

    const zone = frontClearanceZone(subject, c);
    if (zone) {
      const zoneHits = (poly: Vec2[]) => convexOverlapDepth(zone, poly) > c.tolerance;
      const blocked =
        (room !== null && !polygonContainsPolygon(room.polygon, zone, c.tolerance)) ||
        floor.fixtures.some((fx) => zoneHits(fx.footprint)) ||
        others.some((o) => collides(o.catalogId) && zoneHits(furnitureFootprint(o)));
      if (blocked) {
        push(
          'front-clearance',
          `${label} needs ${Math.max(getCatalogItem(subject.catalogId)!.placement.frontClearance, c.walkingClearance).toFixed(2)} m free in front.`,
        );
      }
    }
  }

  return {
    roomId: room?.id ?? null,
    footprint: fp,
    issues,
    hard: issues.some((i) => i.severity === 'hard'),
    blocked: issues.some((i) => c.blocking.includes(i.code)),
  };
}
