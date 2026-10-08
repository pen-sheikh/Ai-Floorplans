import {
  approximateOverlapArea,
  cross,
  distance,
  normalize,
  orientedRect,
  polygonArea,
  polygonContainsPolygon,
  polygonSelfIntersects,
  sub,
  wallLength,
} from './geometry';
import type { Apartment, EntityKind, Floor, IssueSeverity, Vec2 } from './types';
import { SCHEMA_VERSION } from './types';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  entity?: { kind: EntityKind; id: string };
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const finite = (p: Vec2): boolean => Number.isFinite(p.x) && Number.isFinite(p.z);

/** Minimum overlap (m²) between two rooms before it is reported. */
const ROOM_OVERLAP_TOLERANCE = 0.02;

/**
 * Validate an apartment before it is rendered or saved. Errors mean the geometry is broken
 * and must not be rendered as if it were correct; warnings are suspicious but renderable.
 */
/**
 * Optional reference checks. The domain does not know the material library or furniture
 * catalog; callers that do (the app) pass lookups so dangling references are reported.
 */
export interface ValidationContext {
  hasMaterial?: (id: string) => boolean;
  hasCatalogItem?: (id: string) => boolean;
}

export function validateApartment(apt: Apartment, ctx: ValidationContext = {}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, entity?: ValidationIssue['entity']) =>
    issues.push({ severity: 'error', code, message, ...(entity ? { entity } : {}) });
  const warn = (code: string, message: string, entity?: ValidationIssue['entity']) =>
    issues.push({ severity: 'warning', code, message, ...(entity ? { entity } : {}) });

  if (apt.schemaVersion !== SCHEMA_VERSION) {
    err(
      'schema-version',
      `Unsupported schema version ${String(apt.schemaVersion)} (expected ${SCHEMA_VERSION}).`,
    );
  }
  if (!Array.isArray(apt.floors) || apt.floors.length === 0) err('no-floors', 'Apartment has no floors.');

  // Duplicate ids across every entity type.
  const seen = new Map<string, EntityKind>();
  const claim = (kind: EntityKind, id: string) => {
    if (!id) err('missing-id', `A ${kind} has no id.`);
    else if (seen.has(id))
      err('duplicate-id', `Duplicate id "${id}" (${seen.get(id)} and ${kind}).`, { kind, id });
    else seen.set(id, kind);
  };
  for (const f of apt.floors ?? []) {
    claim('floor', f.id);
    f.rooms.forEach((r) => claim('room', r.id));
    f.walls.forEach((w) => claim('wall', w.id));
    f.doors.forEach((d) => claim('door', d.id));
    f.windows.forEach((w) => claim('window', w.id));
    f.fixtures.forEach((x) => claim('fixture', x.id));
    f.furniture.forEach((x) => claim('furniture', x.id));
  }

  for (const f of apt.floors ?? []) validateFloor(f, err, warn, ctx);

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

type Report = (code: string, message: string, entity?: ValidationIssue['entity']) => void;

function validateFloor(floor: Floor, err: Report, warn: Report, ctx: ValidationContext): void {
  // Every structural entity must say where its values came from (measured vs assumed).
  const provenanceOf: [EntityKind, { id: string; sources?: unknown }[]][] = [
    ['wall', floor.walls],
    ['door', floor.doors],
    ['window', floor.windows],
    ['room', floor.rooms],
    ['fixture', floor.fixtures],
  ];
  for (const [kind, list] of provenanceOf) {
    for (const e of list) {
      if (!e.sources || typeof e.sources !== 'object') {
        err('missing-provenance', `${kind} ${e.id} has no provenance (sources).`, { kind, id: e.id });
      }
    }
  }
  if (!(floor.height > 0))
    err('floor-height', `Floor ${floor.id} has invalid height ${floor.height}.`, {
      kind: 'floor',
      id: floor.id,
    });

  // Rooms.
  for (const room of floor.rooms) {
    const ref = { kind: 'room' as const, id: room.id };
    if (room.polygon.length < 3) {
      err('room-polygon-vertices', `${room.name}: polygon needs at least 3 vertices.`, ref);
      continue;
    }
    if (!room.polygon.every(finite)) {
      err('room-polygon-nan', `${room.name}: polygon has non-finite coordinates.`, ref);
      continue;
    }
    if (polygonArea(room.polygon) < 0.05) err('room-area', `${room.name}: area is effectively zero.`, ref);
    if (polygonSelfIntersects(room.polygon))
      err('room-self-intersection', `${room.name}: polygon self-intersects.`, ref);
    for (let i = 0; i < room.polygon.length; i++) {
      if (distance(room.polygon[i]!, room.polygon[(i + 1) % room.polygon.length]!) < 1e-4) {
        err('room-duplicate-vertex', `${room.name}: consecutive duplicate vertices.`, ref);
        break;
      }
    }
    if (!(room.ceilingHeight > 0)) err('room-ceiling', `${room.name}: invalid ceiling height.`, ref);
    for (const id of [
      room.renovation.wallMaterialId,
      room.renovation.floorMaterialId,
      room.renovation.ceilingMaterialId,
    ]) {
      if (ctx.hasMaterial && !ctx.hasMaterial(id))
        warn('unknown-material', `${room.name}: unknown material "${id}".`, ref);
    }
  }
  for (let i = 0; i < floor.rooms.length; i++) {
    for (let j = i + 1; j < floor.rooms.length; j++) {
      const a = floor.rooms[i]!;
      const b = floor.rooms[j]!;
      if (a.polygon.length < 3 || b.polygon.length < 3) continue;
      // Stop once over a generous multiple of the tolerance: the message stays meaningful.
      const overlap = approximateOverlapArea(a.polygon, b.polygon, 0.05, 50 * ROOM_OVERLAP_TOLERANCE);
      if (overlap > ROOM_OVERLAP_TOLERANCE) {
        err('room-overlap', `${a.name} and ${b.name} overlap by ≈${overlap.toFixed(2)} m².`, {
          kind: 'room',
          id: a.id,
        });
      }
    }
  }

  // Walls.
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));
  for (const wall of floor.walls) {
    const ref = { kind: 'wall' as const, id: wall.id };
    if (!finite(wall.start) || !finite(wall.end)) err('wall-nan', `${wall.id}: non-finite endpoints.`, ref);
    else if (wallLength(wall) < 0.01) err('wall-zero-length', `${wall.id}: zero-length wall.`, ref);
    if (!(wall.thickness > 0)) err('wall-thickness', `${wall.id}: thickness must be positive.`, ref);
    if (!(wall.height > 0)) err('wall-height', `${wall.id}: height must be positive.`, ref);
  }
  // Collinear walls that overlap along their length are duplicates (junctions are fine).
  for (let i = 0; i < floor.walls.length; i++) {
    for (let j = i + 1; j < floor.walls.length; j++) {
      const a = floor.walls[i]!;
      const b = floor.walls[j]!;
      const overlap = collinearOverlap(
        a.start,
        a.end,
        b.start,
        b.end,
        Math.max(a.thickness, b.thickness) / 2,
      );
      if (overlap > Math.max(a.thickness, b.thickness) + 0.01) {
        err('wall-overlap', `${a.id} and ${b.id} overlap along ${overlap.toFixed(2)} m.`, {
          kind: 'wall',
          id: a.id,
        });
      }
    }
  }

  // Openings.
  type Span = { id: string; kind: 'door' | 'window'; from: number; to: number };
  const spans = new Map<string, Span[]>();
  const checkOpening = (
    kind: 'door' | 'window',
    o: { id: string; wallId: string; offset: number; width: number; height: number },
    bottom: number,
  ) => {
    const ref = { kind, id: o.id };
    const wall = wallById.get(o.wallId);
    if (!wall) {
      err(`${kind}-missing-wall`, `${o.id}: references missing wall "${o.wallId}".`, ref);
      return;
    }
    if (!(o.width > 0)) err(`${kind}-width`, `${o.id}: width must be positive.`, ref);
    if (!(o.height > 0)) err(`${kind}-height`, `${o.id}: height must be positive.`, ref);
    const len = wallLength(wall);
    const from = o.offset - o.width / 2;
    const to = o.offset + o.width / 2;
    if (from < -1e-3 || to > len + 1e-3)
      err(`${kind}-outside-wall`, `${o.id}: extends beyond wall ${wall.id}.`, ref);
    if (bottom + o.height > wall.height + 1e-3)
      err(`${kind}-too-tall`, `${o.id}: taller than its wall.`, ref);
    const list = spans.get(wall.id) ?? [];
    for (const s of list) {
      if (Math.min(to, s.to) - Math.max(from, s.from) > 1e-3) {
        err('opening-overlap', `${o.id} overlaps ${s.id} on wall ${wall.id}.`, ref);
      }
    }
    list.push({ id: o.id, kind, from, to });
    spans.set(wall.id, list);
  };
  floor.doors.forEach((d) => checkOpening('door', d, 0));
  floor.windows.forEach((w) => {
    if (w.sillHeight < 0) err('window-sill', `${w.id}: negative sill height.`, { kind: 'window', id: w.id });
    checkOpening('window', w, w.sillHeight);
  });

  // Fixtures.
  const roomById = new Map(floor.rooms.map((r) => [r.id, r]));
  for (const fx of floor.fixtures) {
    const ref = { kind: 'fixture' as const, id: fx.id };
    if (fx.footprint.length < 3 || polygonArea(fx.footprint) < 1e-4)
      err('fixture-footprint', `${fx.id}: invalid footprint.`, ref);
    if (!(fx.height > 0)) err('fixture-height', `${fx.id}: height must be positive.`, ref);
    const room = fx.roomId ? roomById.get(fx.roomId) : undefined;
    if (!room) warn('fixture-no-room', `${fx.label}: not inside any room.`, ref);
    else if (!polygonContainsPolygon(room.polygon, fx.footprint, 0.01)) {
      warn('fixture-outside-room', `${fx.label}: extends outside ${room.name}.`, ref);
    }
  }

  // Furniture.
  for (const item of floor.furniture) {
    const ref = { kind: 'furniture' as const, id: item.id };
    const { width, depth, height } = item.dimensions;
    if (!(width > 0 && depth > 0 && height > 0)) {
      err('furniture-dimensions', `${item.name}: dimensions must be positive.`, ref);
      continue;
    }
    if (!finite(item.position) || !Number.isFinite(item.rotation)) {
      err('furniture-transform', `${item.name}: invalid position/rotation.`, ref);
      continue;
    }
    if (ctx.hasCatalogItem && !ctx.hasCatalogItem(item.catalogId))
      warn('furniture-catalog', `${item.name}: unknown catalog item "${item.catalogId}".`, ref);
    const room = roomById.get(item.roomId);
    if (!room) {
      err('furniture-missing-room', `${item.name}: references missing room "${item.roomId}".`, ref);
      continue;
    }
    const fp = orientedRect(item.position, width, depth, item.rotation);
    if (!polygonContainsPolygon(room.polygon, fp, 0.005)) {
      warn('furniture-outside-room', `${item.name}: extends outside ${room.name}.`, ref);
    }
  }
}

/** Length over which two segments are collinear (within `tol`) and overlapping. */
function collinearOverlap(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, tol: number): number {
  const d = normalize(sub(a1, a0));
  if (Math.abs(cross(d, normalize(sub(b1, b0)))) > 1e-3) return 0;
  if (Math.abs(cross(d, sub(b0, a0))) > tol) return 0;
  const proj = (p: Vec2) => (p.x - a0.x) * d.x + (p.z - a0.z) * d.z;
  const [amin, amax] = [0, proj(a1)].sort((x, y) => x - y) as [number, number];
  const [bmin, bmax] = [proj(b0), proj(b1)].sort((x, y) => x - y) as [number, number];
  return Math.max(0, Math.min(amax, bmax) - Math.max(amin, bmin));
}
