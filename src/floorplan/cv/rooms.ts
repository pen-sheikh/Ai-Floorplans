import { distanceTransform } from './morphology';
import { fillConvexPolygon, newMask, type Mask } from './raster';
import { SegmentGrid } from './spatial';
import { along, lineDistance, segDir, segLength, segNormal, type DetectedWall, type Pt } from './walls';

/**
 * Room segmentation from vector walls:
 *   walls (closed across their openings) → barrier raster → outside = free space reachable
 *   from the image border → every other free region = a room → traced polygon.
 * Rooms come from the wall graph, not from guessing at pixel blobs, so doorways never leak
 * one room into the next and concave rooms keep their exact outline.
 */
export interface SegmentedRoom {
  id: string;
  /** Polygon in pixel-edge coordinates, along the inner faces of the walls. */
  polygon: Pt[];
  areaPx: number;
  /** A point well inside the room (for labels). */
  interiorPoint: Pt;
}

export interface RoomSegmentation {
  rooms: SegmentedRoom[];
  /** Outer outline of the unit (outer faces of external walls). */
  footprint: Pt[];
  /** Pixel labels: 0 = wall, −1 = outside, k = rooms[k − 1]. */
  regionOf: Int32Array;
  barrier: Mask;
  width: number;
  height: number;
}

/** Oriented rectangle of a wall (centreline ± thickness/2). */
export function wallPolygon(w: DetectedWall, pad = 0): Pt[] {
  const d = segDir(w);
  const n = segNormal(w);
  const h = w.thickness / 2 + pad;
  const a = { x: w.a.x - d.x * pad, y: w.a.y - d.y * pad };
  const b = { x: w.b.x + d.x * pad, y: w.b.y + d.y * pad };
  return [
    { x: a.x + n.x * h, y: a.y + n.y * h },
    { x: b.x + n.x * h, y: b.y + n.y * h },
    { x: b.x - n.x * h, y: b.y - n.y * h },
    { x: a.x - n.x * h, y: a.y - n.y * h },
  ];
}

export function rasterizeWalls(
  walls: DetectedWall[],
  width: number,
  height: number,
  wallMask?: Mask,
  extraBarriers: readonly { a: Pt; b: Pt; thickness: number }[] = [],
): Mask {
  const m = newMask(width, height);
  for (const w of walls) fillConvexPolygon(m, wallPolygon(w));
  for (const b of extraBarriers)
    fillConvexPolygon(
      m,
      wallPolygon(
        {
          id: '',
          a: b.a,
          b: b.b,
          thickness: b.thickness,
          ends: ['free', 'free'],
          coverage: 0,
          confidence: 0,
        },
        0.5,
      ),
    );
  // The drawn fill closes slivers where vector corners are approximate.
  if (wallMask) for (let i = 0; i < m.data.length; i++) if (wallMask.data[i]) m.data[i] = 1;
  return m;
}

/**
 * Outer boundary of a 4-connected pixel region, as a polygon along pixel edges, simplified.
 * Every boundary edge is collected with the region on its right; edges are chained (turning
 * right at pinch points) and the loop with the largest area is the outer outline.
 */
export function traceRegion(
  inRegion: (x: number, y: number) => boolean,
  box: { x0: number; y0: number; x1: number; y1: number },
  tolerance = 1.1,
): Pt[] {
  const W = box.x1 - box.x0 + 3;
  const key = (x: number, y: number) => (y - box.y0 + 1) * W + (x - box.x0 + 1);
  const out = new Map<number, number[]>(); // start vertex → directions (0 up, 1 right, 2 down, 3 left)
  const add = (x: number, y: number, d: number) => {
    const k = key(x, y);
    const list = out.get(k);
    if (list) list.push(d);
    else out.set(k, [d]);
  };
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      if (!inRegion(x, y)) continue;
      if (!inRegion(x, y - 1)) add(x, y, 1); // top edge, walking right
      if (!inRegion(x + 1, y)) add(x + 1, y, 2); // right edge, walking down
      if (!inRegion(x, y + 1)) add(x + 1, y + 1, 3); // bottom edge, walking left
      if (!inRegion(x - 1, y)) add(x, y + 1, 0); // left edge, walking up
    }
  }
  const dx = [0, 1, 0, -1];
  const dy = [-1, 0, 1, 0];
  let best: Pt[] = [];
  let bestArea = -1;
  for (const [k0, dirs] of out) {
    while (dirs.length) {
      const y0 = Math.floor(k0 / W) - 1 + box.y0;
      const x0 = (k0 % W) - 1 + box.x0;
      let x = x0;
      let y = y0;
      let d = dirs.pop()!;
      const loop: Pt[] = [];
      for (let guard = 0; guard < 4_000_000; guard++) {
        loop.push({ x, y });
        x += dx[d]!;
        y += dy[d]!;
        const k = key(x, y);
        const opts = out.get(k);
        if (!opts || !opts.length) break;
        // Prefer a right turn, then straight, then left (keeps loops separate at pinch points).
        const pick = [(d + 1) % 4, d, (d + 3) % 4].find((c) => opts.includes(c));
        if (pick === undefined) break;
        opts.splice(opts.indexOf(pick), 1);
        d = pick;
        if (x === x0 && y === y0 && !out.get(k0)!.length) break;
      }
      const a = Math.abs(areaOf(loop));
      if (a > bestArea) {
        bestArea = a;
        best = loop;
      }
    }
  }
  return simplifyPolygon(removeCollinear(best), tolerance);
}

function removeCollinear(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i + pts.length - 1) % pts.length]!;
    const c = pts[i]!;
    const n = pts[(i + 1) % pts.length]!;
    if ((c.x - p.x) * (n.y - c.y) - (c.y - p.y) * (n.x - c.x) !== 0) out.push(c);
  }
  return out;
}

/** Douglas–Peucker on a closed ring, anchored at the two farthest-apart vertices. */
export function simplifyPolygon(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 4) return pts;
  const i0 = 0;
  let i1 = 0;
  let far = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.x - pts[0]!.x, pts[i]!.y - pts[0]!.y);
    if (d > far) {
      far = d;
      i1 = i;
    }
  }
  const ring = (a: number, b: number) => {
    const out: Pt[] = [];
    for (let k = a; k !== b; k = (k + 1) % pts.length) out.push(pts[k]!);
    out.push(pts[b]!);
    return out;
  };
  const dp = (seq: Pt[]): Pt[] => {
    if (seq.length <= 2) return seq;
    const a = seq[0]!;
    const b = seq[seq.length - 1]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let best = 0;
    let bi = -1;
    for (let k = 1; k < seq.length - 1; k++) {
      const p = seq[k]!;
      const dist = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
      if (dist > best) {
        best = dist;
        bi = k;
      }
    }
    if (best <= tol) return [a, b];
    const left = dp(seq.slice(0, bi + 1));
    return [...left.slice(0, -1), ...dp(seq.slice(bi))];
  };
  const first = dp(ring(i0, i1));
  const second = dp(ring(i1, i0));
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function areaOf(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export interface RoomSegmentationOptions {
  /** Inferred boundaries (closing open gaps) used as barriers; never treated as walls. */
  extraBarriers?: readonly { a: Pt; b: Pt; thickness: number }[];
  /** Smallest room kept, px² (default (2 × major thickness)²). */
  minAreaPx?: number;
}

export function segmentRooms(
  walls: DetectedWall[],
  width: number,
  height: number,
  majorThickness: number,
  wallMask?: Mask,
  opts: RoomSegmentationOptions = {},
): RoomSegmentation {
  const barrier = rasterizeWalls(walls, width, height, wallMask, opts.extraBarriers);
  const free = newMask(width, height);
  for (let i = 0; i < free.data.length; i++) free.data[i] = barrier.data[i] ? 0 : 1;
  // 4-connectivity for free space so diagonal pixel gaps in walls do not leak.
  const { labels, components } = connectedComponents4(free);
  const touchesBorder = new Set<number>();
  for (let x = 0; x < width; x++) {
    touchesBorder.add(labels[x]!);
    touchesBorder.add(labels[(height - 1) * width + x]!);
  }
  for (let y = 0; y < height; y++) {
    touchesBorder.add(labels[y * width]!);
    touchesBorder.add(labels[y * width + width - 1]!);
  }
  const minArea = opts.minAreaPx ?? (2 * majorThickness) ** 2;
  // A room must also be wide enough to stand in: slivers between two parallel wall lines
  // (double-drawn walls, gaps at joints) are not rooms however long they are.
  const halfWidth = distanceTransform(free);
  const widest = new Float32Array(components.length + 1);
  for (let i = 0; i < labels.length; i++)
    if (labels[i]) widest[labels[i]!] = Math.max(widest[labels[i]!]!, halfWidth[i]!);
  const regionOf = new Int32Array(width * height);
  const rooms: SegmentedRoom[] = [];
  const candidates = components.filter(
    (c) => !touchesBorder.has(c.label) && c.area >= minArea && 2 * widest[c.label]! >= 1.2 * majorThickness,
  );
  const roomIndex = new Map<number, number>();
  // Stable ids: top-to-bottom, left-to-right by bounding box.
  candidates.sort((p, q) => p.box.y0 - q.box.y0 || p.box.x0 - q.box.x0);
  candidates.forEach((c, k) => roomIndex.set(c.label, k + 1));
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]!;
    regionOf[i] = barrier.data[i] ? 0 : touchesBorder.has(l) ? -1 : (roomIndex.get(l) ?? 0);
  }
  for (const c of candidates) {
    const k = roomIndex.get(c.label)!;
    const inRegion = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === c.label;
    const polygon = traceRegion(inRegion, c.box);
    rooms.push({
      id: `room-${k}`,
      polygon,
      areaPx: areaOf(polygon),
      interiorPoint: deepestPoint(inRegion, c.box),
    });
  }
  rooms.sort((p, q) => Number(p.id.slice(5)) - Number(q.id.slice(5)));

  // Footprint: outline of everything that is not outside.
  const notOutside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && regionOf[y * width + x] !== -1;
  const footprint = traceRegion(notOutside, { x0: 0, y0: 0, x1: width, y1: height });
  return { rooms, footprint, regionOf, barrier, width, height };
}

/** 4-connected labelling of a mask (free space must not leak through diagonal wall corners). */
function connectedComponents4(m: Mask) {
  const { width: w, height: h } = m;
  const labels = new Int32Array(w * h);
  const comps: { label: number; area: number; box: { x0: number; y0: number; x1: number; y1: number } }[] =
    [];
  const stack: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (!m.data[i] || labels[i]) continue;
    const label = comps.length + 1;
    const box = { x0: w, y0: h, x1: 0, y1: 0 };
    let area = 0;
    labels[i] = label;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      area++;
      const x = p % w;
      const y = (p - x) / w;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x + 1);
      box.y1 = Math.max(box.y1, y + 1);
      for (const q of [
        x > 0 ? p - 1 : -1,
        x < w - 1 ? p + 1 : -1,
        y > 0 ? p - w : -1,
        y < h - 1 ? p + w : -1,
      ]) {
        if (q >= 0 && m.data[q] && !labels[q]) {
          labels[q] = label;
          stack.push(q);
        }
      }
    }
    comps.push({ label, area, box });
  }
  return { labels, components: comps };
}

/** The region pixel farthest from its boundary (coarse grid search) — a safe label anchor. */
function deepestPoint(
  inRegion: (x: number, y: number) => boolean,
  box: { x0: number; y0: number; x1: number; y1: number },
): Pt {
  let best = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  let bestD = -1;
  const step = Math.max(2, Math.floor(Math.min(box.x1 - box.x0, box.y1 - box.y0) / 20));
  for (let y = box.y0; y < box.y1; y += step) {
    for (let x = box.x0; x < box.x1; x += step) {
      if (!inRegion(x, y)) continue;
      let d = 0;
      while (d < 200 && inRegion(x + d, y) && inRegion(x - d, y) && inRegion(x, y + d) && inRegion(x, y - d))
        d += 1;
      if (d > bestD) {
        bestD = d;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return best;
}

export interface InferredBoundary {
  a: Pt;
  b: Pt;
  /** Length of the closed gap, pixels. */
  gapPx: number;
  fromWall: string;
  toWall?: string;
}

/**
 * Real plans leave room boundaries open: partitions that stop short of the wall opposite,
 * doorways without door symbols, outlines interrupted by symbols or unrecognised openings.
 * Topology closes them: each free wall end (one that meets no other wall) is joined to the
 * wall straight ahead or to another free end ahead, within a reach of a few metres expressed
 * in wall thicknesses, as long as the closing line does not cross drawn walls. The closures
 * are inferences — the caller keeps only those that separate spaces, reports them, and lowers
 * the geometry confidence of the rooms they bound.
 */
export function inferBoundaries(
  walls: DetectedWall[],
  major: number,
  wallMask: Mask,
  reachPx = 12 * major,
): InferredBoundary[] {
  const grid = new SegmentGrid(walls, Math.max(24, 4 * major), reachPx);
  const meets = (w: DetectedWall, p: Pt) =>
    grid
      .near(p, major)
      .some(
        (o) =>
          o !== w &&
          lineDistance(o, p) <= o.thickness / 2 + w.thickness / 2 + 2 &&
          along(o, p) >= -o.thickness &&
          along(o, p) <= segLength(o) + o.thickness,
      );
  const free: { w: DetectedWall; p: Pt; dir: Pt }[] = [];
  for (const w of walls) {
    const d = segDir(w);
    if (!meets(w, w.a)) free.push({ w, p: w.a, dir: { x: -d.x, y: -d.y } });
    if (!meets(w, w.b)) free.push({ w, p: w.b, dir: d });
  }
  // A closing line must not run through drawn walls (other than where it starts and ends).
  const clear = (a: Pt, b: Pt, pad: number) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    for (let t = pad; t <= L - pad; t += 2) {
      const x = Math.floor(a.x + ((b.x - a.x) * t) / L);
      const y = Math.floor(a.y + ((b.y - a.y) * t) / L);
      if (
        x >= 0 &&
        y >= 0 &&
        x < wallMask.width &&
        y < wallMask.height &&
        wallMask.data[y * wallMask.width + x]
      )
        return false;
    }
    return true;
  };
  const out: InferredBoundary[] = [];
  const pairedEnds = new Set<string>();
  for (const f of free) {
    const key = `${f.w.id}|${f.p.x}|${f.p.y}`;
    if (pairedEnds.has(key)) continue;
    let best: InferredBoundary | null = null;
    // (a) Another free end ahead (within ±35° of the wall's direction).
    for (const g of free) {
      if (g === f || g.w === f.w) continue;
      const dx = g.p.x - f.p.x;
      const dy = g.p.y - f.p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2 || dist > reachPx) continue;
      // Nearly straight ahead of the wall (±15°), or — for corner gaps such as a window turning the corner —
      // any nearly horizontal/vertical line that does not lead back behind the wall.
      const ahead = (dx * f.dir.x + dy * f.dir.y) / dist >= Math.cos((15 * Math.PI) / 180);
      const axial =
        Math.min(Math.abs(dx), Math.abs(dy)) / dist <= Math.sin((10 * Math.PI) / 180) &&
        dx * f.dir.x + dy * f.dir.y > -0.2 * dist;
      if (!ahead && !axial) continue;
      if (!clear(f.p, g.p, Math.max(f.w.thickness, g.w.thickness))) continue;
      if (!best || dist < best.gapPx)
        best = { a: f.p, b: g.p, gapPx: dist, fromWall: f.w.id, toWall: g.w.id };
    }
    // (b) The wall straight ahead.
    for (let s = 2; s <= reachPx && (!best || s < best.gapPx); s += 1) {
      const q = { x: f.p.x + f.dir.x * s, y: f.p.y + f.dir.y * s };
      const host = grid
        .near(q, major)
        .find(
          (o) =>
            o !== f.w &&
            lineDistance(o, q) <= o.thickness / 2 + 0.5 &&
            along(o, q) >= 0 &&
            along(o, q) <= segLength(o),
        );
      if (!host) continue;
      if (Math.abs(segDir(host).x * f.dir.x + segDir(host).y * f.dir.y) > 0.9) break; // runs alongside: not a closure
      if (clear(f.p, q, f.w.thickness)) best = { a: f.p, b: q, gapPx: s, fromWall: f.w.id, toWall: host.id };
      break;
    }
    if (!best) continue;
    if (best.toWall) {
      const other = free.find(
        (g) => g.w.id === best!.toWall && Math.hypot(g.p.x - best!.b.x, g.p.y - best!.b.y) < 1,
      );
      if (other) pairedEnds.add(`${other.w.id}|${other.p.x}|${other.p.y}`);
    }
    out.push(best);
  }
  return out;
}
