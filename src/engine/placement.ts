import { getCatalogItem, type PlacementRules } from '../catalog/furnitureCatalog';
import {
  add,
  orientedRect,
  polygonContainsPolygon,
  polygonOverlapDepth,
  protrusion,
  rotateY,
  scale,
  wallFootprint,
} from '../domain/geometry';
import type { Dimensions3, Floor, FurnitureItem, Room, Vec2 } from '../domain/types';
import {
  ISSUE_CATEGORY,
  ISSUE_SEVERITY,
  type IssueCategory,
  type PlacementConstraints,
  type PlacementIssueCode,
} from './constraints';
import { cachedFunctionalZones } from './zones';

export {
  doorZones,
  functionalZones,
  wallSideRect,
  windowZones,
  type DoorZones,
  type FunctionalZone,
} from './zones';

export interface PlacementIssue {
  code: PlacementIssueCode;
  severity: 'hard' | 'soft';
  category: IssueCategory;
  message: string;
  /** The wall/door/fixture/furniture involved, if any. */
  otherId?: string;
  /** How badly the rule is broken, in metres (penetration depth or clearance shortfall). */
  amount?: number;
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

/**
 * What the engine needs to know about a furniture type. Placement depends on dimensions and
 * these rules only — never on how (or whether) the item is rendered.
 */
export interface FurnitureSpec {
  name: string;
  placement: Pick<PlacementRules, 'collides' | 'frontClearance'> & Partial<PlacementRules>;
}
export type CatalogLookup = (catalogId: string) => FurnitureSpec | undefined;

/** The built-in catalog; pass another lookup to use a different catalog. */
export const defaultCatalog: CatalogLookup = getCatalogItem;

export interface PlacementOptions {
  ignoreIds?: ReadonlySet<string>;
  catalog?: CatalogLookup;
}

export const furnitureFootprint = (
  item: Pick<FurnitureItem, 'position' | 'dimensions' | 'rotation'>,
): Vec2[] => orientedRect(item.position, item.dimensions.width, item.dimensions.depth, item.rotation);

/** Free zone the item needs in front of it (local +Z), or null if it needs none. */
export function frontClearanceZone(
  subject: Pick<PlacementSubject, 'catalogId' | 'position' | 'rotation' | 'dimensions'>,
  c: Pick<PlacementConstraints, 'walkingClearance'>,
  catalog: CatalogLookup = defaultCatalog,
): Vec2[] | null {
  const rules = catalog(subject.catalogId)?.placement;
  if (!rules || rules.frontClearance <= 0) return null;
  const depth = Math.max(rules.frontClearance, c.walkingClearance);
  const front = rotateY({ x: 0, z: 1 }, subject.rotation);
  const center = add(subject.position, scale(front, subject.dimensions.depth / 2 + depth / 2));
  return orientedRect(center, subject.dimensions.width, depth, subject.rotation);
}

const fmt = (m: number) => `${m.toFixed(2)} m`;

/**
 * Check a placement against the room boundary, walls, fixed fittings, other furniture,
 * functional zones (door swings/access, window access) and the item's own clearance.
 * Pure and deterministic — the same function serves drag-and-drop, automated fitting and
 * AI-suggested placements. Every violation carries a category and a size in metres.
 */
export function checkPlacement(
  floor: Floor,
  subject: PlacementSubject,
  c: PlacementConstraints,
  options: PlacementOptions = {},
): PlacementReport {
  const catalog = options.catalog ?? defaultCatalog;
  const spec = catalog(subject.catalogId);
  const collides = (id: string) => catalog(id)?.placement.collides ?? true;
  const issues: PlacementIssue[] = [];
  const push = (code: PlacementIssueCode, message: string, otherId?: string, amount?: number) =>
    issues.push({
      code,
      severity: c.requireClear?.includes(code) ? 'hard' : ISSUE_SEVERITY[code],
      category: ISSUE_CATEGORY[code],
      message,
      ...(otherId ? { otherId } : {}),
      ...(amount !== undefined ? { amount: +amount.toFixed(3) } : {}),
    });
  const label = subject.name ?? spec?.name ?? 'Item';
  const fp = orientedRect(
    subject.position,
    subject.dimensions.width,
    subject.dimensions.depth,
    subject.rotation,
  );
  const depthInto = (poly: readonly Vec2[]) => polygonOverlapDepth(fp, poly);

  // Structural: room containment (own room first, then any room — moved through a doorway).
  const ordered: Room[] = [
    ...floor.rooms.filter((r) => r.id === subject.roomId),
    ...floor.rooms.filter((r) => r.id !== subject.roomId),
  ];
  const room = ordered.find((r) => polygonContainsPolygon(r.polygon, fp, c.tolerance)) ?? null;
  if (!room) {
    const home = floor.rooms.find((r) => r.id === subject.roomId);
    const out = home ? protrusion(home.polygon, fp) : undefined;
    push(
      'outside-room',
      `${label} extends outside ${home?.name ?? 'the room'}${out ? ` by ${fmt(out)}` : ''}.`,
      subject.roomId,
      out,
    );
  }

  for (const wall of floor.walls) {
    const d = depthInto(wallFootprint(wall));
    if (d > c.tolerance) push('wall-collision', `${label} intersects a wall by ${fmt(d)}.`, wall.id, d);
  }
  for (const fx of floor.fixtures) {
    const d = depthInto(fx.footprint);
    if (d > c.tolerance)
      push('fixture-collision', `${label} intersects the ${fx.label.toLowerCase()} by ${fmt(d)}.`, fx.id, d);
  }

  // Furniture.
  const ignore = options.ignoreIds ?? new Set<string>();
  const others = floor.furniture.filter(
    (f) => f.id !== subject.id && !ignore.has(f.id) && collides(f.catalogId),
  );
  const itemCollides = collides(subject.catalogId);
  if (itemCollides) {
    for (const other of others) {
      const d = depthInto(furnitureFootprint(other));
      if (d > c.tolerance)
        push(
          'furniture-collision',
          `${label} overlaps the ${other.name.toLowerCase()} by ${fmt(d)}.`,
          other.id,
          d,
        );
    }
  }

  // Functional zones and the item's own clearance only matter for items that block (not rugs).
  if (itemCollides) {
    const top = (subject.elevation ?? 0) + subject.dimensions.height;
    const swingBlocked = new Set<string>();
    for (const zone of cachedFunctionalZones(floor, c)) {
      if (zone.minItemTop !== undefined && top <= zone.minItemTop) continue;
      // A blocked swing already says everything about that door.
      if (zone.kind === 'door-access' && swingBlocked.has(zone.sourceId)) continue;
      const d = depthInto(zone.polygon);
      if (d <= c.tolerance) continue;
      if (zone.kind === 'door-swing') {
        swingBlocked.add(zone.sourceId);
        push('door-swing', `${label} blocks the swing of the ${zone.label} by ${fmt(d)}.`, zone.sourceId, d);
      } else if (zone.kind === 'door-access') {
        if (issues.some((i) => i.code === 'door-clearance' && i.otherId === zone.sourceId)) continue;
        push(
          'door-clearance',
          `${label} is ${fmt(d)} inside the ${fmt(c.doorClearance)} clearance of the ${zone.label}.`,
          zone.sourceId,
          d,
        );
      } else {
        push(
          'window-blocked',
          `${label} is taller than the sill and blocks the window by ${fmt(d)}.`,
          zone.sourceId,
          d,
        );
      }
    }

    const zone = frontClearanceZone(subject, c, catalog);
    if (zone) {
      const need = Math.max(spec?.placement.frontClearance ?? 0, c.walkingClearance);
      let shortfall = 0;
      if (room && !polygonContainsPolygon(room.polygon, zone, c.tolerance))
        shortfall = Math.max(shortfall, protrusion(room.polygon, zone));
      for (const fx of floor.fixtures)
        shortfall = Math.max(shortfall, polygonOverlapDepth(zone, fx.footprint));
      for (const o of others)
        shortfall = Math.max(shortfall, polygonOverlapDepth(zone, furnitureFootprint(o)));
      if (shortfall > c.tolerance) {
        push(
          'front-clearance',
          `${label} needs ${fmt(need)} free in front; ${fmt(shortfall)} of it is obstructed.`,
          undefined,
          shortfall,
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
