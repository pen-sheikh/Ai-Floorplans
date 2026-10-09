import { add, dot, scale, sub, wallDirection, wallLength, wallNormal } from '../domain/geometry';
import { deriveTopology } from '../domain/topology';
import type { Floor, Room, Vec2, Wall } from '../domain/types';

/**
 * Move an interior wall sideways (along its normal) and keep everything that depends on it
 * consistent — deterministically, or not at all:
 *  - the wall's own ends slide along the walls they meet (their "hosts");
 *  - walls that end on this wall slide their end along their own axis, so the junction holds;
 *    openings on them keep their position in the room;
 *  - room outline edges lying on either face of the wall move with it; the corners where they
 *    meet other edges are re-intersected, so neighbouring edges keep their direction;
 *  - topology (room ↔ wall/door/window references, door connections) is re-derived.
 *
 * Every wall and room whose geometry changed is marked `user` (a user correction). Furniture,
 * fixtures, finishes, names, types and extraction confidences are left as they are.
 *
 * Anything this cannot do exactly is refused with a reason instead of approximated:
 * exterior walls and railings (they define the building outline), walls that continue in a
 * straight line into another wall, room edges that run on past the wall, junctions that are
 * close but not touching, room outlines that run alongside the wall close to a face but not on
 * it, and edits that would collapse an attached wall. The result is not
 * validated here: callers validate the whole model (see `planWallMove`, and the document store).
 */

/** Distance within which a point counts as lying on a wall face or centreline (metres). */
export const JUNCTION_TOLERANCE = 0.03;
/** Points closer than this to a wall, but not on it, make a junction or room boundary ambiguous (metres). */
const AMBIGUOUS_GAP = 0.2;
/** Shortest wall an edit may leave behind (metres). */
const MIN_WALL_LENGTH = 0.05;
/** |cos| below which two directions are treated as parallel (a junction cannot slide). */
const MIN_CROSSING = 0.2;

export type WallMoveOutcome =
  { ok: true; floor: Floor; changedWalls: string[]; changedRooms: string[] } | { ok: false; reason: string };

interface Frame {
  start: Vec2;
  d: Vec2;
  n: Vec2;
  length: number;
  half: number;
}
const frameOf = (w: Wall): Frame => ({
  start: w.start,
  d: wallDirection(w),
  n: wallNormal(w),
  length: wallLength(w),
  half: w.thickness / 2,
});
/** Signed distance from the centreline (along n) and position along the wall (along d). */
const local = (f: Frame, p: Vec2) => ({ side: dot(sub(p, f.start), f.n), along: dot(sub(p, f.start), f.d) });

export function moveWall(floor: Floor, wallId: string, distance: number): WallMoveOutcome {
  const wall = floor.walls.find((w) => w.id === wallId);
  if (!wall) return { ok: false, reason: `Wall ${wallId} not found.` };
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-6)
    return { ok: false, reason: 'The move distance must be a non-zero number of metres.' };
  if (wall.kind !== 'interior')
    return {
      ok: false,
      reason: `Only interior walls can be moved for now; ${wall.id} is ${wall.kind === 'railing' ? 'a railing' : 'an exterior wall'} and moving it would change the building outline.`,
    };

  const m = frameOf(wall);
  const delta = scale(m.n, distance);
  const others = floor.walls.filter((w) => w !== wall);

  // The building outline must not touch this wall (it is not updated by this edit).
  for (const p of floor.footprint) {
    const q = local(m, p);
    if (
      Math.abs(q.side) <= m.half + JUNCTION_TOLERANCE &&
      q.along > -JUNCTION_TOLERANCE &&
      q.along < m.length + JUNCTION_TOLERANCE
    )
      return {
        ok: false,
        reason: `${wall.id} is part of the building outline; moving it is not supported yet.`,
      };
  }

  // ── 1. The wall's own ends slide along the wall each one meets ─────────────────────
  // A wall that only continues this one in a straight line cannot carry the end: the end needs a
  // crossing wall to slide along. With one, a parallel neighbour touching the same end is fine
  // (the crossing wall covers the joint); without one, moving would open a gap, so it is refused.
  const hosted = { start: false, end: false };
  const newEnd = (key: 'start' | 'end'): Vec2 | string => {
    const p = wall[key];
    let host: Wall | null = null;
    let best = -1;
    let parallel: Wall | null = null;
    for (const h of others) {
      const f = frameOf(h);
      const q = local(f, p);
      const inExtent =
        q.along >= -(m.half + JUNCTION_TOLERANCE) && q.along <= f.length + m.half + JUNCTION_TOLERANCE;
      if (!inExtent) continue;
      const gap = Math.abs(q.side) - f.half;
      if (gap > AMBIGUOUS_GAP) continue;
      if (gap > JUNCTION_TOLERANCE)
        return `The end of ${wall.id} is ${(gap * 100).toFixed(0)} cm from ${h.id} without touching it; the junction is ambiguous.`;
      const crossing = Math.abs(dot(f.d, m.n));
      if (crossing < MIN_CROSSING) parallel ??= h;
      else if (crossing > best) [host, best] = [h, crossing];
    }
    if (!host && parallel)
      return `${wall.id} continues in a straight line into ${parallel.id} with no crossing wall at the joint; moving them together is not supported yet.`;
    if (!host) return add(p, delta); // a free end moves with the wall
    hosted[key] = true;
    // Slide along the host: keep the same signed offset from the host's centreline.
    const f = frameOf(host);
    const t = -dot(delta, f.n) / dot(m.d, f.n);
    return add(add(p, delta), scale(m.d, t));
  };
  const start = newEnd('start');
  if (typeof start === 'string') return { ok: false, reason: start };
  const end = newEnd('end');
  if (typeof end === 'string') return { ok: false, reason: end };
  if (dot(sub(end, start), m.d) < MIN_WALL_LENGTH)
    return { ok: false, reason: `${wall.id} would become too short.` };

  const walls = new Map<string, Wall>();
  const startShift = new Map<string, number>(); // how far each changed wall's start moved along its axis
  walls.set(wall.id, { ...wall, start, end, sources: { ...wall.sources, geometry: 'user' } });
  startShift.set(wall.id, dot(sub(start, wall.start), m.d));

  // ── 2. Walls that end on this wall slide that end along their own axis ─────────────
  // An end lying on this wall's face within its length is a T-junction: it slides, unless another
  // crossing wall also holds it (then it is pinned and the move is refused). An end just beyond
  // this wall's end (within the other wall's half-thickness) is a corner: it slides only when
  // nothing else holds it (an L-corner); otherwise that wall is a neighbour and stays put.
  const anchoredElsewhere = (w: Wall, p: Vec2): boolean => {
    const dw = wallDirection(w);
    return others.some((x) => {
      if (x === w) return false;
      const f = frameOf(x);
      if (Math.abs(dot(dw, f.n)) < MIN_CROSSING) return false;
      const q = local(f, p);
      const pad = w.thickness / 2 + JUNCTION_TOLERANCE;
      return Math.abs(q.side) - f.half <= JUNCTION_TOLERANCE && q.along >= -pad && q.along <= f.length + pad;
    });
  };
  let lo = 0; // the stretch along this wall that moves: the wall plus the attached wall ends
  let hi = m.length;
  for (const w of others) {
    const f = frameOf(w);
    let next: Wall | null = null;
    for (const key of ['start', 'end'] as const) {
      const p = w[key];
      const q = local(m, p);
      const inExtent =
        q.along >= -(f.half + JUNCTION_TOLERANCE) && q.along <= m.length + f.half + JUNCTION_TOLERANCE;
      if (!inExtent) continue;
      const within = q.along >= -JUNCTION_TOLERANCE && q.along <= m.length + JUNCTION_TOLERANCE;
      const gap = Math.abs(q.side) - m.half;
      if (gap > AMBIGUOUS_GAP) continue;
      if (gap > JUNCTION_TOLERANCE) {
        if (!within) continue;
        return {
          ok: false,
          reason: `${w.id} ends ${(gap * 100).toFixed(0)} cm from ${wall.id} without touching it; the junction is ambiguous.`,
        };
      }
      const crossing = dot(f.d, m.n);
      if (Math.abs(crossing) < MIN_CROSSING) {
        // A parallel wall touching one of this wall's ends stays put when a crossing wall covers
        // that joint (see step 1); anywhere else it would be torn off.
        const atEnd =
          q.along <= f.half + JUNCTION_TOLERANCE
            ? 'start'
            : q.along >= m.length - f.half - JUNCTION_TOLERANCE
              ? 'end'
              : null;
        if (atEnd && hosted[atEnd]) continue;
        return {
          ok: false,
          reason: `${w.id} continues in a straight line from ${wall.id}; moving them together is not supported yet.`,
        };
      }
      if (anchoredElsewhere(w, p)) {
        if (!within) continue; // a neighbour at this wall's end, held by another wall
        return {
          ok: false,
          reason: `${w.id} meets ${wall.id} where another wall also holds it; moving ${wall.id} would tear that junction.`,
        };
      }
      if (w.kind !== 'interior')
        return {
          ok: false,
          reason: `Moving ${wall.id} would stretch ${w.id} (${w.kind === 'railing' ? 'a railing' : 'an exterior wall'}) and change the building outline; not supported yet.`,
        };
      // Keep the end the same distance from the moved centreline.
      const t = distance / crossing;
      const moved = add(p, scale(f.d, t));
      next = { ...(next ?? w), [key]: moved };
      lo = Math.min(lo, q.along - f.half);
      hi = Math.max(hi, q.along + f.half);
      if (key === 'start') startShift.set(w.id, t);
    }
    if (!next) continue;
    if (dot(sub(next.end, next.start), f.d) < MIN_WALL_LENGTH)
      return { ok: false, reason: `Moving ${wall.id} that far would collapse ${w.id}.` };
    walls.set(w.id, { ...next, sources: { ...w.sources, geometry: 'user' } });
  }

  // ── 3. Room edges on either face move with the wall ────────────────────────────────
  // An edge may run past the wall's ends only over attached wall ends that move with it (e.g.
  // the end cap of a wall meeting it at a corner).
  const changedRooms: string[] = [];
  const rooms: Room[] = [];
  for (const room of floor.rooms) {
    const moved = movedRoomPolygon(room.polygon, m, distance, lo, hi);
    if (typeof moved === 'string') return { ok: false, reason: `${room.name}: ${moved}` };
    if (moved === room.polygon) {
      rooms.push(room);
      continue;
    }
    changedRooms.push(room.id);
    rooms.push({ ...room, polygon: moved, sources: { ...room.sources, geometry: 'user' } });
  }

  // ── 4. Openings keep their place on walls whose start moved ────────────────────────
  const shifted = <T extends { wallId: string; offset: number }>(o: T): T => {
    const s = startShift.get(o.wallId);
    return s ? { ...o, offset: o.offset - s } : o;
  };

  const next: Floor = {
    ...floor,
    walls: floor.walls.map((w) => walls.get(w.id) ?? w),
    doors: floor.doors.map(shifted),
    windows: floor.windows.map(shifted),
    rooms,
  };
  return { ok: true, floor: deriveTopology(next), changedWalls: [...walls.keys()], changedRooms };
}

/**
 * The room outline after the wall moved: edges lying on a face of the wall shift by `distance`
 * along the normal; a corner between a shifted and an unshifted edge slides along the
 * unshifted edge. Returns the same array when nothing touches the wall, or a reason string.
 */
function movedRoomPolygon(poly: Vec2[], m: Frame, distance: number, lo: number, hi: number): Vec2[] | string {
  const n = poly.length;
  const q = poly.map((p) => local(m, p));
  const onFace = (i: number): 1 | -1 | 0 => {
    const a = q[i]!;
    const b = q[(i + 1) % n]!;
    for (const s of [1, -1] as const) {
      if (
        Math.abs(a.side - s * m.half) > JUNCTION_TOLERANCE ||
        Math.abs(b.side - s * m.half) > JUNCTION_TOLERANCE
      )
        continue;
      const lo = Math.min(a.along, b.along);
      const hi = Math.max(a.along, b.along);
      if (hi <= JUNCTION_TOLERANCE || lo >= m.length - JUNCTION_TOLERANCE) return 0; // on the line, beside the wall
      return s;
    }
    return 0;
  };
  const faces = poly.map((_, i) => onFace(i));
  // An edge running alongside the wall within reach of a face, but not on it, is ambiguous (e.g. an
  // extracted outline a few cm off the face): left where it is, the wall would move into the room
  // or away from it. Only the part of the edge beside the wall's length counts.
  for (let i = 0; i < n; i++) {
    if (faces[i]) continue;
    const a = q[i]!;
    const b = q[(i + 1) % n]!;
    const run = b.along - a.along;
    if (Math.abs(b.side - a.side) >= MIN_CROSSING * Math.hypot(run, b.side - a.side) || Math.abs(run) < 1e-9)
      continue; // a corner, not a run alongside the wall
    const t0 = Math.min(1, Math.max(0, (JUNCTION_TOLERANCE - a.along) / run));
    const t1 = Math.min(1, Math.max(0, (m.length - JUNCTION_TOLERANCE - a.along) / run));
    if (Math.abs(t1 - t0) * Math.abs(run) <= JUNCTION_TOLERANCE) continue; // beside the wall, not along it
    const gaps = [t0, t1].map((t) => Math.abs(a.side + t * (b.side - a.side)) - m.half);
    if (Math.max(...gaps) <= AMBIGUOUS_GAP) {
      const off = Math.max(...gaps.map(Math.abs));
      return `its outline runs alongside the wall up to ${(off * 100).toFixed(0)} cm off its face without lying on it; the boundary is ambiguous.`;
    }
  }
  if (faces.every((s) => s === 0)) return poly;
  for (let i = 0; i < n; i++) {
    if (!faces[i]) continue;
    const a = q[i]!;
    const b = q[(i + 1) % n]!;
    if (
      Math.min(a.along, b.along) < lo - JUNCTION_TOLERANCE ||
      Math.max(a.along, b.along) > hi + JUNCTION_TOLERANCE
    )
      return 'its outline runs on past the end of the wall (along another wall); splitting room edges is not supported yet.';
  }
  const delta = scale(m.n, distance);
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = faces[(i - 1 + n) % n]!;
    const next = faces[i]!;
    const p = poly[i]!;
    if (!prev && !next) out.push(p);
    else if (prev && next) out.push(add(p, delta));
    else {
      // Slide along the edge that does not move, to where it meets the shifted face.
      const other = prev ? poly[(i + 1) % n]! : poly[(i - 1 + n) % n]!;
      const u = sub(p, other);
      const len = Math.hypot(u.x, u.z);
      const along = dot(scale(u, 1 / len), m.n);
      if (len < 1e-9 || Math.abs(along) < MIN_CROSSING)
        return 'a corner of its outline meets the wall at too shallow an angle to move it exactly.';
      out.push(add(p, scale(u, distance / (len * along))));
    }
  }
  return out;
}
