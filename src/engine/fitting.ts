import { getCatalogItem, type FurnitureCatalogItem } from '../catalog/furnitureCatalog';
import {
  add,
  distance,
  normalize,
  polygonBounds,
  polygonCentroid,
  polygonEdges,
  rotateY,
  rotationFacing,
  scale,
  sub,
  vec,
} from '../domain/geometry';
import type { Dimensions3, Floor, FurnitureItem, Room, Vec2 } from '../domain/types';
import { ISSUE_RULE, type PlacementConstraints } from './constraints';
import { checkPlacement, type PlacementIssue, type PlacementSubject } from './placement';

export interface FitRequest {
  catalogId: string;
  dimensions?: Partial<Dimensions3>;
  materialId?: string;
  color?: string;
  /** Override the catalog's wall preference. */
  preferWall?: 'longest' | 'any';
}

/** A candidate pose and what it would violate. */
export interface FitAttempt {
  position: Vec2;
  rotation: number;
  violations: PlacementIssue[];
}

export type FitFailureKind =
  'unknown-room' | 'unknown-item' | 'too-large' | 'no-wall-long-enough' | 'no-valid-position';

export interface FitPlacement {
  request: FitRequest;
  /** True when a position without hard violations was found. */
  ok: boolean;
  /** The placed item (present when ok). */
  item?: FurnitureItem;
  /** Soft issues the chosen spot still has (empty = ideal). */
  issues: PlacementIssue[];
  failure?: FitFailureKind;
  /** Short reason, suitable for a toast. */
  reason?: string;
  /** On failure: the candidate that came closest, with measured violations. */
  bestAttempt?: FitAttempt;
  /** Number of candidate poses evaluated (for diagnostics). */
  candidatesTried: number;
}

export interface FitResult {
  placements: FitPlacement[];
  /** Floor including all successfully placed items. */
  floor: Floor;
}

export interface FitOptions {
  newId: () => string;
  /** Catalog to read dimensions and placement rules from (defaults to the built-in one). */
  catalog?: (id: string) => FurnitureCatalogItem | undefined;
}

interface Candidate {
  position: Vec2;
  rotation: number;
  /** Lower is better; added to 100 × soft issue count. */
  score: number;
}

const STEP = 0.05;
const GRID = 0.1;

const hardTotal = (issues: PlacementIssue[]) =>
  issues.filter((i) => i.severity === 'hard').reduce((sum, i) => sum + (i.amount ?? 1), 0);

/**
 * Deterministic automated furniture fitting.
 *
 * For each request (in order) the engine generates candidate poses — backs against room
 * edges for wall-placed items, a grid in two orientations for free-standing ones — and keeps
 * the best pose with no hard violation under `checkPlacement`. Placed items become obstacles
 * for later requests. On failure it reports the closest attempt and what it violated, by how
 * much. Input: model geometry + dimensions + constraints; no rendering state is involved.
 */
export function fitFurniture(
  floor: Floor,
  roomId: string,
  requests: readonly FitRequest[],
  constraints: PlacementConstraints,
  options: FitOptions | (() => string),
): FitResult {
  const opts: FitOptions = typeof options === 'function' ? { newId: options } : options;
  const lookup = opts.catalog ?? getCatalogItem;
  const room = floor.rooms.find((r) => r.id === roomId);
  let current = floor;
  const placements: FitPlacement[] = [];
  const fail = (
    request: FitRequest,
    failure: FitFailureKind,
    reason: string,
    extra: Partial<FitPlacement> = {},
  ) => placements.push({ request, ok: false, issues: [], failure, reason, candidatesTried: 0, ...extra });

  for (const request of requests) {
    const cat = lookup(request.catalogId);
    if (!room) {
      fail(request, 'unknown-room', `Unknown room ${roomId}.`);
      continue;
    }
    if (!cat) {
      fail(request, 'unknown-item', `Unknown furniture ${request.catalogId}.`);
      continue;
    }
    const dims: Dimensions3 = { ...cat.dimensions, ...request.dimensions };
    const name = cat.name.toLowerCase();
    const size = `${dims.width.toFixed(2)} × ${dims.depth.toFixed(2)} m`;

    // Cheap impossibility check: bigger than the room's extents in both orientations.
    const b = polygonBounds(room.polygon);
    const [W, D] = [b.maxX - b.minX, b.maxZ - b.minZ];
    const fitsBox = (w: number, d: number) => (w <= W && d <= D) || (w <= D && d <= W);
    if (!fitsBox(dims.width, dims.depth)) {
      fail(
        request,
        'too-large',
        `A ${name} (${size}) is larger than ${room.name} (${W.toFixed(2)} × ${D.toFixed(2)} m) in every orientation.`,
      );
      continue;
    }

    const candidates = cat.placement.againstWall
      ? wallCandidates(room, dims, request.preferWall ?? cat.placement.preferWall, constraints.wallGap)
      : freeCandidates(room, dims, anchorFor(current, room, cat, dims));
    if (!candidates.length) {
      fail(
        request,
        'no-wall-long-enough',
        `No wall in ${room.name} is long enough for a ${name} (${dims.width.toFixed(2)} m wide).`,
      );
      continue;
    }

    let best: { c: Candidate; issues: PlacementIssue[]; total: number } | null = null;
    let closest: { attempt: FitAttempt; badness: number } | null = null;
    let tried = 0;
    for (const c of candidates) {
      tried++;
      const subject: PlacementSubject = {
        catalogId: cat.id,
        roomId: room.id,
        position: c.position,
        rotation: c.rotation,
        dimensions: dims,
      };
      const report = checkPlacement(current, subject, constraints, { catalog: lookup });
      if (report.hard || report.roomId !== room.id) {
        const badness =
          report.issues.filter((i) => i.severity === 'hard').length * 10 + hardTotal(report.issues);
        if (!closest || badness < closest.badness) {
          closest = {
            attempt: { position: c.position, rotation: c.rotation, violations: report.issues },
            badness,
          };
        }
        continue;
      }
      const total = report.issues.length * 100 + c.score;
      if (!best || total < best.total) best = { c, issues: report.issues, total };
      if (best.issues.length === 0 && c.score === 0) break;
    }

    if (!best) {
      fail(
        request,
        'no-valid-position',
        `No position or orientation in ${room.name} fits a ${name} (${size}) without breaking a hard rule.`,
        { candidatesTried: tried, ...(closest ? { bestAttempt: closest.attempt } : {}) },
      );
      continue;
    }
    const item: FurnitureItem = {
      id: opts.newId(),
      catalogId: cat.id,
      name: cat.name,
      category: cat.category,
      roomId: room.id,
      position: best.c.position,
      elevation: 0,
      rotation: best.c.rotation,
      dimensions: dims,
      materialId: request.materialId ?? cat.defaultMaterialId,
      ...(request.color ? { color: request.color } : {}),
    };
    current = { ...current, furniture: [...current.furniture, item] };
    placements.push({ request, ok: true, item, issues: best.issues, candidatesTried: tried });
  }

  return { placements, floor: current };
}

/**
 * Multi-line explanation of a fitting result, written for people and for an AI assistant to
 * relay ("Cannot place king-size bed … best candidate violated door swing by 0.18 m").
 */
export function explainFit(p: FitPlacement, itemName: string, roomName?: string): string {
  const where = roomName ? ` in ${roomName}` : '';
  if (p.ok) {
    if (!p.issues.length) return `Placed ${itemName}${where}. All hard rules and clearances are satisfied.`;
    return [`Placed ${itemName}${where}, with compromises:`, ...p.issues.map((i) => `- ${i.message}`)].join(
      '\n',
    );
  }
  const lines = [`Cannot place ${itemName}${where}.`, `Reason: ${p.reason ?? 'no valid position.'}`];
  if (p.bestAttempt) {
    lines.push(`Checked ${p.candidatesTried} candidate positions/orientations.`);
    lines.push('Best candidate violated:');
    for (const v of p.bestAttempt.violations) {
      const by = v.amount !== undefined ? ` by ${v.amount.toFixed(2)} m` : '';
      lines.push(`- ${ISSUE_RULE[v.code]}${by}${v.severity === 'soft' ? ' (preference)' : ''}`);
    }
  }
  return lines.join('\n');
}

/** Back against each room edge, facing inwards, centred first then sliding outwards. */
function wallCandidates(room: Room, dims: Dimensions3, prefer: 'longest' | 'any', gap: number): Candidate[] {
  const edges = polygonEdges(room.polygon)
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.length >= dims.width);
  if (prefer === 'longest') edges.sort((a, b) => b.length - a.length);
  const out: Candidate[] = [];
  edges.forEach((e, rank) => {
    const dir = normalize(sub(e.b, e.a));
    const rotation = rotationFacing(e.inward);
    const half = dims.width / 2;
    const mid = e.length / 2;
    const slots: number[] = [mid];
    for (let k = STEP; mid - k >= half - 1e-9; k += STEP) slots.push(mid - k, mid + k);
    for (const t of slots) {
      if (t < half - 1e-9 || t > e.length - half + 1e-9) continue;
      const position = add(add(e.a, scale(dir, t)), scale(e.inward, dims.depth / 2 + gap));
      out.push({ position, rotation, score: rank * 10 + Math.abs(t - mid) });
    }
  });
  return out;
}

/** Grid over the room, nearest to the anchor (or the centroid) first. */
function freeCandidates(
  room: Room,
  dims: Dimensions3,
  anchor: { point: Vec2; rotation: number } | null,
): Candidate[] {
  const b = polygonBounds(room.polygon);
  const target = anchor?.point ?? polygonCentroid(room.polygon);
  const longest = polygonEdges(room.polygon).reduce((m, e) => (e.length > m.length ? e : m));
  const base = anchor?.rotation ?? rotationFacing(longest.inward);
  const rotations = anchor ? [base] : [base, base + Math.PI / 2];
  const out: Candidate[] = [];
  // No centre closer to the bounds than half the item's smaller side can be valid.
  const inset = Math.min(dims.width, dims.depth) / 2;
  for (let x = b.minX + inset; x <= b.maxX - inset + 1e-9; x += GRID) {
    for (let z = b.minZ + inset; z <= b.maxZ - inset + 1e-9; z += GRID) {
      const p = vec(x, z);
      for (const rotation of rotations) {
        out.push({ position: p, rotation, score: distance(p, target) + (rotation === base ? 0 : 0.05) });
      }
    }
  }
  out.sort((a, b2) => a.score - b2.score);
  return out;
}

/** Functional relationships: where a free-standing item ideally goes relative to others. */
function anchorFor(
  floor: Floor,
  room: Room,
  cat: FurnitureCatalogItem,
  dims: Dimensions3,
): { point: Vec2; rotation: number } | null {
  const inRoom = floor.furniture.filter((f) => f.roomId === room.id);
  const front = (f: FurnitureItem, gap: number) => {
    const fwd = rotateY({ x: 0, z: 1 }, f.rotation);
    return add(f.position, scale(fwd, f.dimensions.depth / 2 + gap + dims.depth / 2));
  };
  if (cat.category === 'coffee-table') {
    const sofa = inRoom.find((f) => f.category === 'sofa');
    if (sofa) return { point: front(sofa, 0.45), rotation: sofa.rotation };
  }
  if (cat.category === 'office-chair') {
    const desk = inRoom.find((f) => f.category === 'desk');
    if (desk) return { point: front(desk, 0.05), rotation: desk.rotation + Math.PI };
  }
  if (cat.category === 'dining-chair') {
    const table = inRoom.find((f) => f.category === 'dining-table');
    if (table) return { point: front(table, -0.15), rotation: table.rotation + Math.PI };
  }
  if (cat.category === 'rug') {
    const sofa = inRoom.find((f) => f.category === 'sofa');
    if (sofa) return { point: front(sofa, 0.2), rotation: sofa.rotation };
    const bed = inRoom.find((f) => f.category === 'bed');
    if (bed) return { point: bed.position, rotation: bed.rotation };
  }
  return null;
}
