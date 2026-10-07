import {
  connectedComponents,
  distanceTransform,
  fillSmallHoles,
  selectComponents,
  skeletonize,
} from './morphology';
import type { Preprocessed, ThicknessProfile } from './preprocess';
import { newMask, type Mask } from './raster';

/** A point in image pixel-EDGE coordinates (pixel i covers [i, i + 1)). */
export interface Pt {
  x: number;
  y: number;
}

export type WallEndKind = 'free' | 'junction' | 'corner';

/** A straight wall: centreline, thickness and how well the image supports it. */
export interface DetectedWall {
  id: string;
  a: Pt;
  b: Pt;
  /** Pixels. */
  thickness: number;
  ends: [WallEndKind, WallEndKind];
  /** Fraction of the centreline that lies on wall fill. */
  coverage: number;
  confidence: number;
}

export interface WallDetection {
  walls: DetectedWall[];
  /** Solid wall fill (thin lines and text removed). */
  wallMask: Mask;
  profile: ThicknessProfile;
}

// ── small vector helpers ──────────────────────────────────────────────────────────
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const addv = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const len = (a: Pt): number => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const segLength = (w: { a: Pt; b: Pt }): number => len(sub(w.b, w.a));
export const segDir = (w: { a: Pt; b: Pt }): Pt => unit(sub(w.b, w.a));
/** Left normal of the a→b direction in image coordinates. */
export const segNormal = (w: { a: Pt; b: Pt }): Pt => {
  const d = segDir(w);
  return { x: -d.y, y: d.x };
};

/** Distance from p to the infinite line through w. */
export function lineDistance(w: { a: Pt; b: Pt }, p: Pt): number {
  return Math.abs(dot(sub(p, w.a), segNormal(w)));
}

/** Position of p projected onto w, as distance from a. */
export const along = (w: { a: Pt; b: Pt }, p: Pt): number => dot(sub(p, w.a), segDir(w));

export function intersectLines(p: { a: Pt; b: Pt }, q: { a: Pt; b: Pt }): Pt | null {
  const d1 = sub(p.b, p.a);
  const d2 = sub(q.b, q.a);
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.a.x - p.a.x) * d2.y - (q.a.y - p.a.y) * d2.x) / den;
  return addv(p.a, mul(d1, t));
}

/** Mask lookup in edge coordinates (pixel = floor). */
export function onMask(m: Mask, p: Pt): boolean {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  return x >= 0 && y >= 0 && x < m.width && y < m.height && m.data[y * m.width + x] === 1;
}

/** Distance from p along dir until leaving the mask (step 0.25 px, capped). */
export function runLength(m: Mask, p: Pt, dir: Pt, max: number): number {
  let s = 0;
  while (s <= max && onMask(m, addv(p, mul(dir, s)))) s += 0.25;
  return s;
}

// ── 1. wall mask ─────────────────────────────────────────────────────────────────

/**
 * Morphological opening with a disc of radius r (≈ 35 % of the thinnest wall class):
 * erode (keep ink ≥ r from paper) then dilate back. Thin linework, hatching and text
 * strokes vanish; solid walls keep their exact outline.
 */
export function wallMaskFrom(pre: Preprocessed, profile: ThicknessProfile): Mask {
  const { ink, inkDistance } = pre;
  const r = Math.max(1.5, 0.35 * profile.minor);
  const core = newMask(ink.width, ink.height);
  for (let i = 0; i < core.data.length; i++) core.data[i] = inkDistance[i]! >= r ? 1 : 0;
  const notCore = newMask(ink.width, ink.height);
  for (let i = 0; i < core.data.length; i++) notCore.data[i] = core.data[i] ? 0 : 1;
  const toCore = distanceTransform(notCore);
  const opened = newMask(ink.width, ink.height);
  for (let i = 0; i < opened.data.length; i++) opened.data[i] = ink.data[i] && toCore[i]! <= r + 0.75 ? 1 : 0;
  // Drop isolated blobs that are too small to be walls (symbols, bold glyphs) — but keep short
  // solid piers about one wall thick (between a door and a window, or a column).
  const { labels, components } = connectedComponents(opened);
  const minExtent = 2.5 * profile.major;
  const isPier = (c: { area: number; box: { x0: number; y0: number; x1: number; y1: number } }) => {
    const w = c.box.x1 - c.box.x0;
    const h = c.box.y1 - c.box.y0;
    return (
      Math.min(w, h) >= 0.8 * profile.minor &&
      Math.min(w, h) <= 1.3 * profile.major &&
      c.area / (w * h) >= 0.85
    );
  };
  const keep = new Set(
    components
      .filter((c) => Math.max(c.box.x1 - c.box.x0, c.box.y1 - c.box.y0) >= minExtent || isPier(c))
      .map((c) => c.label),
  );
  // Close small enclosed holes (jamb squares, hatching gaps) so the skeleton has no loops there.
  return fillSmallHoles(selectComponents(labels, keep, ink.width, ink.height), (profile.major * 0.9) ** 2);
}

// ── 2. skeleton graph ────────────────────────────────────────────────────────────

interface GNode {
  id: number;
  p: Pt;
  edges: Set<number>;
}
interface GEdge {
  id: number;
  a: number;
  b: number;
  pts: Pt[];
}

const N8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

function skeletonGraph(skel: Mask): { nodes: Map<number, GNode>; edges: Map<number, GEdge> } {
  const { width: w, height: h, data } = skel;
  const nb = (i: number): number[] => {
    const x = i % w;
    const y = (i - x) / w;
    const out: number[] = [];
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && data[ny * w + nx]) out.push(ny * w + nx);
    }
    return out;
  };
  const center = (i: number): Pt => ({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5 });
  const nodeOf = new Map<number, number>();
  const nodes = new Map<number, GNode>();
  const edges = new Map<number, GEdge>();
  let nextNode = 0;
  let nextEdge = 0;

  // Node pixels: endpoints and junction pixels (degree ≠ 2), clustered.
  const pixels: number[] = [];
  for (let i = 0; i < data.length; i++) if (data[i]) pixels.push(i);
  const isNodePx = new Set(pixels.filter((i) => nb(i).length !== 2));
  for (const p of isNodePx) {
    if (nodeOf.has(p)) continue;
    const id = nextNode++;
    const cluster = [p];
    nodeOf.set(p, id);
    for (let k = 0; k < cluster.length; k++) {
      for (const q of nb(cluster[k]!)) {
        if (isNodePx.has(q) && !nodeOf.has(q)) {
          nodeOf.set(q, id);
          cluster.push(q);
        }
      }
    }
    const c = cluster.map(center).reduce((s, q) => addv(s, q), { x: 0, y: 0 });
    nodes.set(id, { id, p: mul(c, 1 / cluster.length), edges: new Set() });
  }

  const visited = new Uint8Array(data.length);
  const addEdge = (a: number, b: number, pts: Pt[]) => {
    const id = nextEdge++;
    edges.set(id, { id, a, b, pts });
    nodes.get(a)!.edges.add(id);
    nodes.get(b)!.edges.add(id);
  };
  const trace = (startNode: number, startPx: number, first: number) => {
    const pts = [nodes.get(startNode)!.p, center(first)];
    visited[first] = 1;
    let prev = startPx;
    let cur = first;
    for (;;) {
      const next = nb(cur).filter((r) => r !== prev && !(visited[r] && !isNodePx.has(r)));
      const nodeHit = next.find((r) => isNodePx.has(r) && !(nodeOf.get(r) === startNode && pts.length < 3));
      if (nodeHit !== undefined) {
        const end = nodeOf.get(nodeHit)!;
        pts.push(nodes.get(end)!.p);
        if (end !== startNode || pts.length > 4) addEdge(startNode, end, pts);
        return;
      }
      const step = next.find((r) => !isNodePx.has(r));
      if (step === undefined) {
        // Dead end inside a degree-2 run (rare thinning artefact): end with a new node.
        const id = nextNode++;
        nodes.set(id, { id, p: center(cur), edges: new Set() });
        addEdge(startNode, id, pts);
        return;
      }
      visited[step] = 1;
      pts.push(center(step));
      prev = cur;
      cur = step;
    }
  };
  for (const p of isNodePx) {
    for (const q of nb(p)) {
      if (isNodePx.has(q)) {
        const a = nodeOf.get(p)!;
        const b = nodeOf.get(q)!;
        if (a < b && ![...nodes.get(a)!.edges].some((e) => [edges.get(e)!.a, edges.get(e)!.b].includes(b))) {
          addEdge(a, b, [nodes.get(a)!.p, nodes.get(b)!.p]);
        }
      } else if (!visited[q]) trace(nodeOf.get(p)!, p, q);
    }
  }
  // Closed loops without any node pixel.
  for (const p of pixels) {
    if (visited[p] || isNodePx.has(p)) continue;
    const id = nextNode++;
    nodes.set(id, { id, p: center(p), edges: new Set() });
    isNodePx.add(p);
    nodeOf.set(p, id);
    for (const q of nb(p)) if (!visited[q]) trace(id, p, q);
  }
  return { nodes, edges };
}

function polylineLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += len(sub(pts[i]!, pts[i - 1]!));
  return l;
}

/** Remove short dangling branches created by thinning thick corners and end caps. */
function pruneSpurs(
  g: { nodes: Map<number, GNode>; edges: Map<number, GEdge> },
  thicknessAt: (p: Pt) => number,
): void {
  for (let round = 0; round < 3; round++) {
    let removed = false;
    for (const e of [...g.edges.values()]) {
      const na = g.nodes.get(e.a)!;
      const nb = g.nodes.get(e.b)!;
      const freeA = na.edges.size === 1;
      const freeB = nb.edges.size === 1;
      if (freeA === freeB) continue; // keep isolated pieces and junction-to-junction edges
      const junction = freeA ? nb : na;
      if (polylineLength(e.pts) < 1.0 * thicknessAt(junction.p)) {
        g.edges.delete(e.id);
        na.edges.delete(e.id);
        nb.edges.delete(e.id);
        if (!na.edges.size) g.nodes.delete(na.id);
        if (!nb.edges.size) g.nodes.delete(nb.id);
        removed = true;
      }
    }
    if (!removed) break;
  }
}

/** Douglas–Peucker; returns indices of kept vertices. */
function simplify(pts: Pt[], tol: number): number[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1;
    let bestD = tol;
    for (let k = i + 1; k < j; k++) {
      const d =
        segLength({ a: pts[i]!, b: pts[j]! }) < 1e-9
          ? len(sub(pts[k]!, pts[i]!))
          : lineDistance({ a: pts[i]!, b: pts[j]! }, pts[k]!);
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return [...keep.keys()].filter((k) => keep[k]);
}

/** Straight pieces (≥ minLength) of thin linework: skeleton → pixel graph → Douglas–Peucker. */
export function lineSegments(mask: Mask, minLength: number, tol = 1.2): { a: Pt; b: Pt }[] {
  const g = skeletonGraph(skeletonize(mask));
  const out: { a: Pt; b: Pt }[] = [];
  for (const e of g.edges.values()) {
    const idx = simplify(e.pts, tol);
    for (let k = 1; k < idx.length; k++) {
      const a = e.pts[idx[k - 1]!]!;
      const b = e.pts[idx[k]!]!;
      if (segLength({ a, b }) >= minLength) out.push({ a, b });
    }
  }
  return out;
}

// ── 3. segments ──────────────────────────────────────────────────────────────────

interface Seg {
  a: Pt;
  b: Pt;
  na: number;
  nb: number;
  thickness: number;
  coverage: number;
  thicknessSpread: number;
}

/** Re-measure a segment from perpendicular profiles: true centreline, thickness, coverage. */
function refine(seg: Seg, mask: Mask, maxThickness: number): Seg {
  const L = segLength(seg);
  const d = segDir(seg);
  const n = segNormal(seg);
  const margin = Math.min(L / 3, seg.thickness * 1.2);
  const thick: number[] = [];
  const offs: number[] = [];
  let hits = 0;
  let total = 0;
  for (let t = margin; t <= L - margin; t += 2) {
    const p = addv(seg.a, mul(d, t));
    total++;
    if (!onMask(mask, p)) continue;
    hits++;
    const plus = runLength(mask, p, n, maxThickness) - 0.125;
    const minus = runLength(mask, p, mul(n, -1), maxThickness) - 0.125;
    if (plus + minus > maxThickness) continue; // ran into a perpendicular wall
    thick.push(plus + minus);
    offs.push((plus - minus) / 2);
  }
  if (!thick.length) return { ...seg, coverage: total ? hits / total : 0 };
  const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
  const T = med(thick);
  const shift = mul(n, med(offs));
  const spread = med(thick.map((x) => Math.abs(x - T))) / Math.max(T, 1);
  return {
    ...seg,
    a: addv(seg.a, shift),
    b: addv(seg.b, shift),
    thickness: T,
    coverage: hits / Math.max(total, 1),
    thicknessSpread: spread,
  };
}

/** Snap segments within `deg` of horizontal/vertical exactly onto the axis. */
function snapAxis(s: Seg, deg = 3): Seg {
  const d = segDir(s);
  const tol = Math.sin((deg * Math.PI) / 180);
  if (Math.abs(d.y) < tol) {
    const y = (s.a.y + s.b.y) / 2;
    return { ...s, a: { x: s.a.x, y }, b: { x: s.b.x, y } };
  }
  if (Math.abs(d.x) < tol) {
    const x = (s.a.x + s.b.x) / 2;
    return { ...s, a: { x, y: s.a.y }, b: { x, y: s.b.y } };
  }
  return s;
}

const isAxisAligned = (s: { a: Pt; b: Pt }) => {
  const d = segDir(s);
  return Math.abs(d.x) < 1e-6 || Math.abs(d.y) < 1e-6;
};

/**
 * Thinning artefacts: where wall fill changes thickness (a half-filled window, a step between
 * a thick and a thin wall) the skeleton produces short diagonal stubs. Real angled walls are
 * long, so non-axis pieces shorter than 1.5 × the major thickness are dropped.
 */
function removeArtifacts(segs: Seg[], profile: ThicknessProfile): Seg[] {
  return segs.filter((s) => isAxisAligned(s) || segLength(s) >= 1.5 * profile.major);
}

/**
 * Merge parallel pieces of the same wall that overlap or touch along their length
 * (skeleton edges split at T-junctions on both sides of a thick wall).
 */
function mergeOverlapping(segs: Seg[]): Seg[] {
  const out = [...segs];
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = i + 1; j < out.length && !changed; j++) {
        const s1 = out[i]!;
        const s2 = out[j]!;
        if (Math.abs(dot(segDir(s1), segDir(s2))) < Math.cos((3 * Math.PI) / 180)) continue;
        const tMin = Math.min(s1.thickness, s2.thickness);
        if (Math.max(s1.thickness, s2.thickness) / Math.max(tMin, 1e-6) > 1.35) continue;
        const mid2 = mul(addv(s2.a, s2.b), 0.5);
        if (lineDistance(s1, mid2) > Math.max(1.5, 0.35 * tMin)) continue;
        const t1 = [0, segLength(s1)];
        const t2 = [along(s1, s2.a), along(s1, s2.b)].sort((x, y) => x - y) as [number, number];
        if (Math.min(t1[1]!, t2[1]) - Math.max(t1[0]!, t2[0]) < -1) continue; // disjoint
        const d = segDir(s1);
        const lo = Math.min(0, t2[0]);
        const hi = Math.max(t1[1]!, t2[1]);
        const pick = (t: number, fallback: Seg) => (t === 0 || t === t1[1] ? s1 : fallback);
        const l1 = segLength(s1);
        const l2 = segLength(s2);
        const merged: Seg = {
          a: addv(s1.a, mul(d, lo)),
          b: addv(s1.a, mul(d, hi)),
          na: pick(lo, s2) === s1 ? s1.na : along(s1, s2.a) < along(s1, s2.b) ? s2.na : s2.nb,
          nb: pick(hi, s2) === s1 ? s1.nb : along(s1, s2.a) > along(s1, s2.b) ? s2.na : s2.nb,
          thickness: (s1.thickness * l1 + s2.thickness * l2) / (l1 + l2),
          coverage: Math.max(s1.coverage, s2.coverage),
          thicknessSpread: Math.max(s1.thicknessSpread, s2.thicknessSpread),
        };
        out.splice(j, 1);
        out.splice(i, 1, merged);
        changed = true;
      }
    }
  }
  return out;
}

export interface WallDetectionOptions {
  /** Max angle (degrees) between segments merged as one straight wall. */
  mergeAngleDeg?: number;
}

/**
 * Detect straight walls in a preprocessed plan. Output is vector geometry in pixel-edge
 * coordinates; every threshold is relative to the plan's own measured wall thickness.
 */
export function detectWalls(
  pre: Preprocessed,
  profile: ThicknessProfile,
  opts: WallDetectionOptions = {},
): WallDetection {
  const wallMask = wallMaskFrom(pre, profile);
  const skel = skeletonize(wallMask);
  const g = skeletonGraph(skel);
  const dist = distanceTransform(wallMask);
  const thicknessAt = (p: Pt) => {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return Math.max(2, 2 * (dist[y * wallMask.width + x] ?? 1));
  };
  pruneSpurs(g, thicknessAt);

  // Polylines → straight pieces. Interior DP vertices become corner nodes.
  let nextNode = Math.max(-1, ...g.nodes.keys()) + 1;
  const nodePos = new Map<number, Pt>([...g.nodes.values()].map((n) => [n.id, n.p]));
  let segs: Seg[] = [];
  for (const e of g.edges.values()) {
    const ts = e.pts.map(thicknessAt).sort((x, y) => x - y);
    const T = ts[Math.floor(ts.length / 2)] ?? profile.minor;
    if (polylineLength(e.pts) < 0.6 * T) continue;
    const idx = simplify(e.pts, Math.max(1.5, 0.15 * T));
    let prevNode = e.a;
    for (let k = 1; k < idx.length; k++) {
      const last = k === idx.length - 1;
      const nodeB = last ? e.b : nextNode++;
      if (!last) nodePos.set(nodeB, e.pts[idx[k]!]!);
      segs.push({
        a: nodePos.get(prevNode)!,
        b: nodePos.get(nodeB)!,
        na: prevNode,
        nb: nodeB,
        thickness: T,
        coverage: 1,
        thicknessSpread: 0,
      });
      prevNode = nodeB;
    }
  }

  const maxT = profile.major * 1.6;
  segs = segs.filter((s) => segLength(s) >= 1).map((s) => snapAxis(refine(s, wallMask, maxT)));

  // Merge collinear pieces that meet at a node (through T-junctions and straight runs).
  const angleCos = Math.cos(((opts.mergeAngleDeg ?? 4) * Math.PI) / 180);
  for (let changed = true; changed;) {
    changed = false;
    const ends = new Map<number, number[]>();
    segs.forEach((s, i) => {
      ends.set(s.na, [...(ends.get(s.na) ?? []), i]);
      ends.set(s.nb, [...(ends.get(s.nb) ?? []), i]);
    });
    outer: for (const [node, list] of ends) {
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const s1 = segs[list[x]!]!;
          const s2 = segs[list[y]!]!;
          if (s1 === s2) continue;
          const far1 = s1.na === node ? s1.b : s1.a;
          const far2 = s2.na === node ? s2.b : s2.a;
          const nodeP = s1.na === node ? s1.a : s1.b;
          const u1 = unit(sub(far1, nodeP));
          const u2 = unit(sub(far2, s2.na === node ? s2.a : s2.b));
          if (dot(u1, u2) > -angleCos) continue;
          const ratio =
            Math.max(s1.thickness, s2.thickness) / Math.max(1e-6, Math.min(s1.thickness, s2.thickness));
          if (ratio > 1.35) continue;
          if (lineDistance(s1, far2) > Math.max(1.5, 0.35 * Math.min(s1.thickness, s2.thickness))) continue;
          const l1 = segLength(s1);
          const l2 = segLength(s2);
          const merged: Seg = snapAxis({
            a: far1,
            b: far2,
            na: s1.na === node ? s1.nb : s1.na,
            nb: s2.na === node ? s2.nb : s2.na,
            thickness: (s1.thickness * l1 + s2.thickness * l2) / (l1 + l2),
            coverage: (s1.coverage * l1 + s2.coverage * l2) / (l1 + l2),
            thicknessSpread: Math.max(s1.thicknessSpread, s2.thicknessSpread),
          });
          segs = segs.filter((s) => s !== s1 && s !== s2).concat([merged]);
          changed = true;
          break outer;
        }
      }
    }
  }

  // Reconcile shared nodes: L-corners meet at the line intersection; T-stems end on the wall.
  const endsAt = new Map<number, { seg: Seg; end: 'a' | 'b' }[]>();
  for (const s of segs) {
    endsAt.set(s.na, [...(endsAt.get(s.na) ?? []), { seg: s, end: 'a' }]);
    endsAt.set(s.nb, [...(endsAt.get(s.nb) ?? []), { seg: s, end: 'b' }]);
  }
  const kinds = new Map<Seg, [WallEndKind, WallEndKind]>(segs.map((s) => [s, ['free', 'free']]));
  const setEnd = (s: Seg, end: 'a' | 'b', p: Pt, kind: WallEndKind) => {
    s[end] = p;
    kinds.get(s)![end === 'a' ? 0 : 1] = kind;
  };
  for (const [, list] of endsAt) {
    if (list.length === 2) {
      const [e1, e2] = list as [{ seg: Seg; end: 'a' | 'b' }, { seg: Seg; end: 'a' | 'b' }];
      const x = intersectLines(e1.seg, e2.seg);
      if (x) {
        setEnd(e1.seg, e1.end, x, 'corner');
        setEnd(e2.seg, e2.end, x, 'corner');
      }
    } else if (list.length > 2) {
      for (const e of list) kinds.get(e.seg)![e.end === 'a' ? 0 : 1] = 'junction';
    }
  }
  for (const s of segs) {
    for (const end of ['a', 'b'] as const) {
      const k = kinds.get(s)![end === 'a' ? 0 : 1];
      if (k === 'corner') continue;
      const p = s[end];
      // T-junction: the node lies on another (merged) wall → end exactly on that wall's centreline.
      const host = segs.find(
        (o) =>
          o !== s &&
          lineDistance(o, p) < 0.6 * o.thickness + 1 &&
          along(o, p) > -o.thickness &&
          along(o, p) < segLength(o) + o.thickness &&
          Math.abs(dot(segDir(o), segDir(s))) < 0.5,
      );
      if (host) {
        const x = intersectLines(s, host);
        if (x) setEnd(s, end, x, 'junction');
        continue;
      }
      if (k === 'free') {
        // Free end: the skeleton stops ~T/2 short of the wall end; walk to the end face.
        const dir = end === 'a' ? mul(segDir(s), -1) : segDir(s);
        const back = mul(dir, -0.5);
        const ext = runLength(wallMask, addv(p, back), dir, 2 * s.thickness) - 0.5 - 0.125;
        setEnd(s, end, addv(p, mul(dir, Math.max(0, ext))), 'free');
      }
    }
  }
  // L-corners: extend each wall to the other wall's outer face so corners are closed.
  for (const [, list] of endsAt) {
    if (list.length !== 2 || kinds.get(list[0]!.seg)![list[0]!.end === 'a' ? 0 : 1] !== 'corner') continue;
    const [e1, e2] = list as [{ seg: Seg; end: 'a' | 'b' }, { seg: Seg; end: 'a' | 'b' }];
    for (const [me, other] of [
      [e1, e2],
      [e2, e1],
    ] as const) {
      const dir = me.end === 'a' ? mul(segDir(me.seg), -1) : segDir(me.seg);
      me.seg[me.end] = addv(me.seg[me.end], mul(dir, other.seg.thickness / 2));
    }
  }

  segs = mergeOverlapping(removeArtifacts(segs, profile));

  const walls = segs
    .filter((s) => segLength(s) >= 0.8 * s.thickness)
    .map((s) => {
      const L = segLength(s);
      const confidence = Math.max(
        0,
        Math.min(
          1,
          0.55 * s.coverage +
            0.25 * (1 - Math.min(1, s.thicknessSpread * 4)) +
            0.2 * Math.min(1, L / (4 * s.thickness)),
        ),
      );
      return { s, L, confidence };
    })
    .sort(
      (p, q) =>
        (p.s.a.y + p.s.b.y) / 2 - (q.s.a.y + q.s.b.y) / 2 ||
        (p.s.a.x + p.s.b.x) / 2 - (q.s.a.x + q.s.b.x) / 2,
    )
    .map(({ s, confidence }, i): DetectedWall => ({
      id: `w${i + 1}`,
      a: s.a,
      b: s.b,
      thickness: s.thickness,
      ends: kinds.get(s) ?? ['free', 'free'],
      coverage: s.coverage,
      confidence: +confidence.toFixed(3),
    }));
  return { walls, wallMask, profile };
}
