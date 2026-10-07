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
import type { PlacementConstraints } from './constraints';
import { checkPlacement, type PlacementIssue, type PlacementSubject } from './placement';

export interface FitRequest {
  catalogId: string;
  dimensions?: Partial<Dimensions3>;
  materialId?: string;
  color?: string;
  /** Override the catalog's wall preference. */
  preferWall?: 'longest' | 'any';
}

export interface FitPlacement {
  request: FitRequest;
  ok: boolean;
  /** The placed item (present when ok). */
  item?: FurnitureItem;
  /** Soft issues the chosen spot still has. */
  issues: PlacementIssue[];
  reason?: string;
}

export interface FitResult {
  placements: FitPlacement[];
  /** Floor including all successfully placed items. */
  floor: Floor;
}

interface Candidate {
  position: Vec2;
  rotation: number;
  /** Lower is better; added to 100 × soft issue count. */
  score: number;
}

const STEP = 0.05;
const GRID = 0.1;

/**
 * Deterministic automated furniture fitting.
 *
 * For each request (in order) the engine generates candidate poses — backs against room
 * edges for wall-placed items, a grid for free-standing ones — and keeps the best pose that
 * has no hard issue under `checkPlacement`. Placed items become obstacles for later requests.
 * AI layers may *suggest* requests; only this function decides where (and whether) they fit.
 */
export function fitFurniture(
  floor: Floor,
  roomId: string,
  requests: readonly FitRequest[],
  constraints: PlacementConstraints,
  newId: () => string,
): FitResult {
  const room = floor.rooms.find((r) => r.id === roomId);
  let current = floor;
  const placements: FitPlacement[] = [];

  for (const request of requests) {
    const cat = getCatalogItem(request.catalogId);
    if (!room || !cat) {
      placements.push({
        request,
        ok: false,
        issues: [],
        reason: !room ? `Unknown room ${roomId}.` : `Unknown furniture ${request.catalogId}.`,
      });
      continue;
    }
    const dims: Dimensions3 = { ...cat.dimensions, ...request.dimensions };
    const candidates = cat.placement.againstWall
      ? wallCandidates(room, dims, request.preferWall ?? cat.placement.preferWall, constraints.wallGap)
      : freeCandidates(room, dims, anchorFor(current, room, cat, dims));

    let best: { c: Candidate; issues: PlacementIssue[]; total: number } | null = null;
    for (const c of candidates) {
      const subject: PlacementSubject = {
        catalogId: cat.id,
        roomId: room.id,
        position: c.position,
        rotation: c.rotation,
        dimensions: dims,
      };
      const report = checkPlacement(current, subject, constraints);
      if (report.hard || report.roomId !== room.id) continue;
      const total = report.issues.length * 100 + c.score;
      if (!best || total < best.total) best = { c, issues: report.issues, total };
      if (best.issues.length === 0 && c.score === 0) break;
    }

    if (!best) {
      placements.push({
        request,
        ok: false,
        issues: [],
        reason: `No position in ${room.name} fits a ${cat.name.toLowerCase()} (${dims.width.toFixed(2)} × ${dims.depth.toFixed(2)} m) without collisions.`,
      });
      continue;
    }
    const item: FurnitureItem = {
      id: newId(),
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
    placements.push({ request, ok: true, item, issues: best.issues });
  }

  return { placements, floor: current };
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
