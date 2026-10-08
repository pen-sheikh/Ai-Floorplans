import type { ThicknessProfile } from './preprocess';
import { SegmentGrid } from './spatial';
import type { GrayImage, Mask } from './raster';
import {
  along,
  intersectLines,
  lineDistance,
  onMask,
  segDir,
  segLength,
  segNormal,
  type DetectedWall,
  type Pt,
} from './walls';

/**
 * Openings are found by testing gaps (and solid walls) for the symbols plans use:
 *  - hinged door: a leaf line perpendicular to the wall plus a quarter-circle swing arc,
 *  - double door: two half-width arcs from both jambs,
 *  - window: two or more thin lines running along the wall inside the wall band,
 *  - plain opening: a gap between two collinear walls with no symbol (low confidence).
 * A gap is only bridged (walls continued across it) when one of these is found.
 */
export type OpeningKind = 'door' | 'window' | 'opening';

export interface DetectedOpening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  doorKind?: 'hinged' | 'double';
  /** Distance along the host wall from its `a` end, pixels. */
  from: number;
  to: number;
  /** For hinged doors: hinge at the `from` end ('start') or the `to` end ('end'). */
  hinge?: 'start' | 'end';
  /** Side the leaf swings into, along the wall's left normal (+1) or the opposite (−1). */
  swingSide?: 1 | -1;
  /** How unambiguous the hinge side and swing direction are. */
  swingConfidence?: number;
  confidence: number;
  evidence: { door: number; window: number };
}

export interface OpeningDetection {
  walls: DetectedWall[];
  openings: DetectedOpening[];
}

const addv = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const pointAt = (w: DetectedWall, t: number, side = 0): Pt =>
  addv(addv(w.a, mul(segDir(w), t)), mul(segNormal(w), side));

export interface OpeningContext {
  gray: GrayImage;
  wallMask: Mask;
  profile: ThicknessProfile;
  /** Grey level below which a pixel counts as drawn linework (thin lines are lighter than walls). */
  lineThreshold: number;
}

/**
 * Any thin drawn line within ~1.5 px of p. Wall fill is excluded: door and window symbols are
 * linework, and counting walls would make every wall corner look like a door leaf.
 */
function inkNear(ctx: OpeningContext, p: Pt): boolean {
  const { gray, lineThreshold, wallMask } = ctx;
  const x0 = Math.floor(p.x - 1);
  const y0 = Math.floor(p.y - 1);
  for (let y = y0; y <= y0 + 2; y++) {
    for (let x = x0; x <= x0 + 2; x++) {
      if (x < 0 || y < 0 || x >= gray.width || y >= gray.height) continue;
      const i = y * gray.width + x;
      if (gray.data[i]! < lineThreshold && !wallMask.data[i]) return true;
    }
  }
  return false;
}

/** Exact-pixel version (no neighbourhood) for counting separate parallel lines. */
function inkAt(ctx: OpeningContext, p: Pt): boolean {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= ctx.gray.width || y >= ctx.gray.height) return false;
  const i = y * ctx.gray.width + x;
  return ctx.gray.data[i]! < ctx.lineThreshold && !ctx.wallMask.data[i];
}

interface DoorFit {
  score: number;
  kind: 'hinged' | 'double';
  hinge: 'start' | 'end';
  side: 1 | -1;
  radius: number;
  /** How clearly this hinge/side beats the alternatives (0 = ambiguous, 1 = clear). */
  swingConfidence: number;
}

/**
 * Score door symbols for a span [from, to] on wall w. The hinge sits on the wall face; the
 * leaf runs perpendicular to the wall and the arc sweeps back to the other jamb.
 */
export function scoreDoor(ctx: OpeningContext, w: DetectedWall, from: number, to: number): DoorFit {
  const g = to - from;
  const d = segDir(w);
  const n = segNormal(w);
  let best: DoorFit = { score: 0, kind: 'hinged', hinge: 'start', side: 1, radius: g, swingConfidence: 0 };
  // Best score per orientation (hinge × side), to judge how clear the chosen orientation is.
  const perOrientation = new Map<string, number>();
  const note = (hinge: string, side: number, score: number) => {
    const k = `${hinge}|${side}`;
    perOrientation.set(k, Math.max(perOrientation.get(k) ?? 0, score));
  };
  // Arc: for each angle, accept ink at ±8 % of the radius (symbols are drawn by hand, or
  // slightly elliptical). Leaf: a line from the hinge perpendicular to the wall.
  const arcScore = (hinge: Pt, toward: Pt, swing: Pt, r: number) => {
    let arc = 0;
    let leaf = 0;
    const A = 14;
    for (let k = 1; k <= A; k++) {
      const th = ((10 + (70 * (k - 1)) / (A - 1)) * Math.PI) / 180;
      const dir = addv(mul(toward, Math.cos(th)), mul(swing, Math.sin(th)));
      if ([0.92, 1, 1.08].some((f) => inkNear(ctx, addv(hinge, mul(dir, f * r))))) arc++;
    }
    const Lk = 8;
    for (let k = 1; k <= Lk; k++) {
      if (inkNear(ctx, addv(hinge, mul(swing, (0.15 + (0.75 * k) / Lk) * r)))) leaf++;
    }
    // The swept area of a door symbol is drawn empty; text, fittings or hatching are not.
    let clear = 0;
    let probes = 0;
    for (const th of [25, 35, 45, 55, 65]) {
      const rad = (th * Math.PI) / 180;
      const dir = addv(mul(toward, Math.cos(rad)), mul(swing, Math.sin(rad)));
      for (const f of [0.45, 0.7]) {
        probes++;
        if (!inkAt(ctx, addv(hinge, mul(dir, f * r)))) clear++;
      }
    }
    return { arc: arc / A, leaf: leaf / Lk, clear: clear / probes };
  };
  // Both parts of the symbol must be present, around an empty swept area.
  const combine = (s: { arc: number; leaf: number; clear: number }) =>
    (0.6 * s.arc + 0.4 * s.leaf) * (s.arc >= 0.45 && s.leaf >= 0.4 ? 1 : 0.5) * Math.min(1, s.clear / 0.8);
  // Jamb squares/frames put the hinge slightly inside the gap: locate it from the leaf line
  // (1 px steps over the first 15 % of the gap), then test the arc from the best positions.
  const leafAt = (H: Pt, swing: Pt, r: number) => {
    let hit = 0;
    for (let k = 1; k <= 8; k++) if (inkNear(ctx, addv(H, mul(swing, (0.15 + (0.75 * k) / 8) * r)))) hit++;
    return hit / 8;
  };
  const insets = (swing: Pt, face: number, hinge: 'start' | 'end') => {
    const cands: { px: number; leaf: number }[] = [];
    for (let px = 0; px <= Math.max(2, 0.15 * g); px += 1) {
      const hT = hinge === 'start' ? from + px : to - px;
      cands.push({ px, leaf: leafAt(pointAt(w, hT, face), swing, g * 0.9) });
    }
    return cands
      .sort((p, q) => q.leaf - p.leaf || p.px - q.px)
      .slice(0, 2)
      .map((c) => c.px);
  };
  for (const side of [1, -1] as const) {
    const swing = mul(n, side);
    const face = (w.thickness / 2) * side;
    for (const hinge of ['start', 'end'] as const) {
      const toward = hinge === 'start' ? d : mul(d, -1);
      for (const px of insets(swing, face, hinge)) {
        const hT = hinge === 'start' ? from + px : to - px;
        const H = pointAt(w, hT, face);
        for (const f of [0.8, 0.88, 0.95, 1.02]) {
          const r = (g - px) * f;
          const score = combine(arcScore(H, toward, swing, r));
          note(hinge, side, score);
          if (score > best.score)
            best = { score, kind: 'hinged', hinge, side, radius: r, swingConfidence: 0 };
        }
      }
    }
    // Double door: two half-width leaves hinged at both jambs, same side.
    const [i1 = 0] = insets(swing, face, 'start');
    const [i2 = 0] = insets(swing, face, 'end');
    {
      for (const f of [0.84, 0.94, 1.04]) {
        const r = ((g - i1 - i2) / 2) * f;
        const s1 = combine(arcScore(pointAt(w, from + i1, face), d, swing, r));
        const s2 = combine(arcScore(pointAt(w, to - i2, face), mul(d, -1), swing, r));
        const score = Math.min(s1, s2);
        note('both', side, score);
        if (score > best.score)
          best = { score, kind: 'double', hinge: 'start', side, radius: r, swingConfidence: 0 };
      }
    }
  }
  const bestKey = `${best.kind === 'double' ? 'both' : best.hinge}|${best.side}`;
  const alt = Math.max(0, ...[...perOrientation].filter(([k]) => k !== bestKey).map(([, v]) => v));
  best.swingConfidence =
    best.score > 0 ? +Math.min(1, Math.max(0, 1.5 * (1 - alt / best.score))).toFixed(3) : 0;
  return best;
}

/**
 * Window symbol: inside the wall band across the span, perpendicular profiles cross ≥ 2 thin
 * lines (glazing/frame lines running along the wall). `band` = which part of the thickness to
 * test: 'full', or one half for partially filled walls.
 */
export function scoreWindow(
  ctx: OpeningContext,
  w: DetectedWall,
  from: number,
  to: number,
  band: 'full' | 1 | -1 = 'full',
): number {
  const g = to - from;
  if (g <= 2) return 0;
  const n = segNormal(w);
  const half = w.thickness / 2;
  const [lo, hi] = band === 'full' ? [-half - 1, half + 1] : band === 1 ? [0, half + 1] : [-half - 1, 0];
  let hits = 0;
  let total = 0;
  for (let t = from + 0.15 * g; t <= to - 0.15 * g; t += Math.max(2, g / 20)) {
    total++;
    if (glazingRuns(ctx, w, t, lo, hi, n) >= 2) hits++;
  }
  return total ? hits / total : 0;
}

/** Separate thin lines crossed by the wall's perpendicular profile at t, between offsets lo..hi. */
function glazingRuns(
  ctx: OpeningContext,
  w: DetectedWall,
  t: number,
  lo: number,
  hi: number,
  n = segNormal(w),
): number {
  let runs = 0;
  let inRun = false;
  for (let s = lo; s <= hi; s += 0.5) {
    const ink = inkAt(ctx, addv(pointAt(w, t), mul(n, s)));
    if (ink && !inRun) runs++;
    inRun = ink;
  }
  return runs;
}

/** Extent of the glazing lines within [from, to] (for windows set into part of a wall's thickness). */
export function glazingExtent(
  ctx: OpeningContext,
  w: DetectedWall,
  from: number,
  to: number,
  band: 1 | -1,
): { from: number; to: number } | null {
  const half = w.thickness / 2;
  const [lo, hi] = band === 1 ? [0, half + 1] : [-half - 1, 0];
  let first = NaN;
  let last = NaN;
  for (let t = from; t <= to; t += 0.5) {
    if (glazingRuns(ctx, w, t, lo, hi) < 2) continue;
    if (Number.isNaN(first)) first = t;
    last = t;
  }
  return Number.isNaN(first) ? null : { from: first, to: last + 0.5 };
}

/**
 * Smoothness of a swing arc: walking the arc angle by angle, the radius at which ink is found
 * changes gradually for a drawn curve (circular or slightly elliptical), but jumps around for
 * unrelated straight lines, text or appliance symbols that happen to cross the samples.
 */
export function arcContinuity(
  ctx: OpeningContext,
  w: DetectedWall,
  fit: DoorFit,
  from: number,
  to: number,
): number {
  const d = segDir(w);
  const n = segNormal(w);
  const hT = fit.hinge === 'start' ? from : to;
  const toward = fit.hinge === 'start' ? d : mul(d, -1);
  const swing = mul(n, fit.side);
  const H = pointAt(w, hT, (w.thickness / 2) * fit.side);
  let prev: number | null = null;
  const jumps: number[] = [];
  let found = 0;
  const A = 24;
  for (let k = 0; k < A; k++) {
    const th = ((12 + (66 * k) / (A - 1)) * Math.PI) / 180;
    const dir = addv(mul(toward, Math.cos(th)), mul(swing, Math.sin(th)));
    let best: number | null = null;
    for (let f = 0.78; f <= 1.22; f += 0.02) {
      if (
        inkAt(ctx, addv(H, mul(dir, f * fit.radius))) &&
        (best === null || Math.abs(f - (prev ?? 1)) < Math.abs(best - (prev ?? 1)))
      )
        best = f;
    }
    if (best === null) continue;
    found++;
    if (prev !== null) jumps.push(Math.abs(best - prev));
    prev = best;
  }
  if (found < 0.75 * A || !jumps.length) return 0;
  const med = [...jumps].sort((x, y) => x - y)[Math.floor(jumps.length / 2)]!;
  const big = jumps.filter((j) => j > 0.07).length / jumps.length;
  return med <= 0.03 && big <= 0.15 ? 1 - big : 0;
}

/** Dense check that the quarter-disc swept by the leaf is empty floor (no text, fittings…). */
export function sectorClear(
  ctx: OpeningContext,
  w: DetectedWall,
  fit: DoorFit,
  from: number,
  to: number,
): number {
  const d = segDir(w);
  const hT = fit.hinge === 'start' ? from : to;
  const toward = fit.hinge === 'start' ? d : mul(d, -1);
  const swing = mul(segNormal(w), fit.side);
  const H = pointAt(w, hT, (w.thickness / 2) * fit.side);
  let clear = 0;
  let total = 0;
  for (let th = 15; th <= 75; th += 10) {
    const rad = (th * Math.PI) / 180;
    const dir = addv(mul(toward, Math.cos(rad)), mul(swing, Math.sin(rad)));
    for (const f of [0.3, 0.45, 0.6, 0.75, 0.85]) {
      total++;
      if (!inkNear(ctx, addv(H, mul(dir, f * fit.radius)))) clear++;
    }
  }
  return clear / total;
}

/**
 * Door frames (jambs) are often drawn as small boxes inside the wall gap. The clear opening —
 * what a door width means — is between their inner faces: scanning from each end of the gap,
 * the innermost line spanning the wall band within one wall thickness marks that face.
 */
export function clearOpening(
  ctx: OpeningContext,
  w: DetectedWall,
  from: number,
  to: number,
): { from: number; to: number } {
  const n = segNormal(w);
  const half = w.thickness / 2;
  const spans = (t: number) => {
    let hit = 0;
    let total = 0;
    for (let s = -0.4 * half * 2; s <= 0.4 * half * 2; s += 1) {
      total++;
      if (inkAt(ctx, addv(pointAt(w, t), mul(n, s)))) hit++;
    }
    return hit / total >= 0.7;
  };
  const maxInset = Math.min(1.1 * w.thickness, 0.2 * (to - from));
  const inset = (sign: 1 | -1) => {
    const end = sign > 0 ? from : to;
    let inner = 0;
    for (let k = 0.5; k <= maxInset; k += 0.5) if (spans(end + sign * k)) inner = k;
    // Samples are floored to pixels, so the far edge of the last line pixel is half a step on.
    return inner ? inner + (sign > 0 ? 0.5 : 0) : 0;
  };
  const a = inset(1);
  const b = inset(-1);
  return to - from - a - b > 0.5 * (to - from) ? { from: from + a, to: to - b } : { from, to };
}

interface Gap {
  kind: 'collinear' | 'to-wall';
  w1: DetectedWall;
  /** Collinear partner, or the wall the ray hit. */
  w2: DetectedWall;
  end: 'a' | 'b';
  /** Gap on w1's line, distances from w1.a (may be negative or beyond w1's length). */
  from: number;
  to: number;
}

/**
 * Two walls lie on one line. Short pieces have poorly determined angles, so the angle tolerance
 * grows as the shorter piece shrinks, and the test that decides is symmetric: one line fitted
 * through all four end points must pass close to every one of them.
 */
function collinear(w1: DetectedWall, w2: DetectedWall): boolean {
  const d1 = segDir(w1);
  const d2 = segDir(w2);
  const minLen = Math.min(segLength(w1), segLength(w2));
  const tol = Math.min(
    (8 * Math.PI) / 180,
    Math.max((3 * Math.PI) / 180, Math.atan(3 / Math.max(1, minLen))),
  );
  if (Math.abs(d1.x * d2.x + d1.y * d2.y) < Math.cos(tol)) return false;
  const pts = [w1.a, w1.b, w2.a, w2.b];
  const c = mul(pts.reduce(addv, { x: 0, y: 0 }), 0.25);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - c.x) ** 2;
    sxy += (p.x - c.x) * (p.y - c.y);
    syy += (p.y - c.y) ** 2;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal direction
  const n = { x: -Math.sin(theta), y: Math.cos(theta) };
  const dTol = Math.max(1.5, 0.2 * Math.min(w1.thickness, w2.thickness));
  return pts.every((p) => Math.abs((p.x - c.x) * n.x + (p.y - c.y) * n.y) <= dTol);
}

/** Gaps at the ends of `only` (default: every wall), looking for partners among all `walls`. */
function findGaps(
  walls: DetectedWall[],
  profile: ThicknessProfile,
  wallMask: Mask,
  only: readonly DetectedWall[] = walls,
): Gap[] {
  // Long enough for picture windows; a gap is only bridged when a symbol is found in it.
  const gapMax = 30 * profile.major;
  const gaps: Gap[] = [];
  const grid = new SegmentGrid(walls, Math.max(24, 4 * profile.major), 2 * profile.major);
  // A gap starts where the wall FILL ends: short stubs (e.g. between a junction and a door)
  // are not always vectorised, but they are still wall.
  const trim = (g: Gap): Gap => {
    const len = g.to - g.from;
    let from = g.from;
    let to = g.to;
    while (from < g.from + 0.5 * len && onMask(wallMask, pointAt(g.w1, from + 1))) from++;
    while (to > g.to - 0.5 * len && onMask(wallMask, pointAt(g.w1, to - 1))) to--;
    return { ...g, from, to };
  };
  // An opening is empty along the wall line; wall fill there means another wall runs along it.
  const isOpen = (g: Gap) => {
    if (g.to - g.from <= 2) return false;
    let filled = 0;
    let n = 0;
    for (let t = g.from + 1; t < g.to - 1; t += 2, n++) if (onMask(wallMask, pointAt(g.w1, t))) filled++;
    return !n || filled / n <= 0.3;
  };
  for (const w1 of only) {
    const L1 = segLength(w1);
    const d1 = segDir(w1);
    for (const end of ['a', 'b'] as const) {
      const sign = end === 'a' ? -1 : 1;
      const endT = end === 'a' ? 0 : L1;
      // Collinear partner beyond this end (only walls in the corridor ahead can qualify).
      const e = pointAt(w1, endT);
      const f = pointAt(w1, endT + sign * gapMax);
      const r = w1.thickness;
      const ahead = grid.query({
        x0: Math.min(e.x, f.x) - r,
        y0: Math.min(e.y, f.y) - r,
        x1: Math.max(e.x, f.x) + r,
        y1: Math.max(e.y, f.y) + r,
      });
      let bestCol: Gap | null = null;
      for (const w2 of ahead) {
        if (w2 === w1) continue;
        if (Math.max(w1.thickness, w2.thickness) / Math.min(w1.thickness, w2.thickness) > 1.35) continue;
        if (!collinear(w1, w2)) continue;
        const t2 = [along(w1, w2.a), along(w1, w2.b)];
        const near = sign > 0 ? Math.min(...t2) : Math.max(...t2);
        const gap = (near - endT) * sign;
        if (gap <= 1 || gap > gapMax) continue;
        const g: Gap = {
          kind: 'collinear',
          w1,
          w2,
          end,
          from: sign > 0 ? endT : near,
          to: sign > 0 ? near : endT,
        };
        if (!bestCol || gap < bestCol.to - bestCol.from) bestCol = g;
      }
      if (bestCol) {
        const g = trim(bestCol);
        if (isOpen(g)) gaps.push(g);
        continue;
      }
      // Ray from the end along the wall until it meets wall fill; the gap ends there. The fill
      // may be a short stub that continues to the host wall, so keep walking through it.
      let hit = -1;
      for (let s = 1; s <= gapMax + 3 * profile.major; s += 1) {
        const p = pointAt(w1, endT + sign * s);
        if (!onMask(wallMask, p)) {
          if (hit >= 0) break; // fill ended without reaching a wall
          if (s > gapMax) break;
          continue;
        }
        if (hit < 0) hit = s;
        const host = grid
          .near(p, 2)
          .find(
            (o) =>
              o !== w1 &&
              lineDistance(o, p) <= o.thickness / 2 + 1.5 &&
              along(o, p) >= -1 &&
              along(o, p) <= segLength(o) + 1,
          );
        if (!host) {
          if (s - hit > 3 * profile.major) break;
          continue;
        }
        if (Math.abs(d1.x * segDir(host).x + d1.y * segDir(host).y) > 0.5) break;
        if (hit > 2) {
          const g = trim({
            kind: 'to-wall',
            w1,
            w2: host,
            end,
            from: sign > 0 ? endT : endT - hit,
            to: sign > 0 ? endT + hit : endT,
          });
          if (isOpen(g)) gaps.push(g);
        }
        break;
      }
    }
  }
  // Each collinear gap is found from both sides; keep one.
  return gaps.filter(
    (g, i) =>
      g.kind !== 'collinear' ||
      !gaps.slice(0, i).some((h) => h.kind === 'collinear' && h.w1 === g.w2 && h.w2 === g.w1),
  );
}

export interface OpeningOptions {
  doorThreshold?: number;
  windowThreshold?: number;
}

/**
 * Detect openings and bridge the walls they interrupt. Returns the final wall set (bridged
 * walls merged) and openings positioned along their host walls.
 */
export function detectOpenings(
  ctx: OpeningContext,
  wallsIn: DetectedWall[],
  opts: OpeningOptions = {},
): OpeningDetection {
  const doorT = opts.doorThreshold ?? 0.55;
  const winT = opts.windowThreshold ?? 0.5;
  let walls = wallsIn.map((w) => ({ ...w }));
  // Openings live on walls; when walls merge, their openings move with them.
  const openings = new Map<DetectedWall, Omit<DetectedOpening, 'wallId' | 'id'>[]>();
  const getOps = (w: DetectedWall) => openings.get(w) ?? [];

  const mergeCollinear = (
    w1: DetectedWall,
    w2: DetectedWall,
    extra: Omit<DetectedOpening, 'wallId' | 'id'>[],
  ) => {
    const ts = [0, segLength(w1), along(w1, w2.a), along(w1, w2.b)];
    const lo = Math.min(...ts);
    const hi = Math.max(...ts);
    // The line through the two outermost end points is better determined than either piece.
    const ends = [w1.a, w1.b, w2.a, w2.b];
    let [ea, eb] = [ends[ts.indexOf(lo)]!, ends[ts.indexOf(hi)]!];
    const ang = Math.atan2(Math.abs(eb.y - ea.y), Math.abs(eb.x - ea.x));
    if (ang < (1.5 * Math.PI) / 180) {
      const y = (ea.y + eb.y) / 2;
      [ea, eb] = [
        { x: ea.x, y },
        { x: eb.x, y },
      ];
    } else if (ang > (88.5 * Math.PI) / 180) {
      const x = (ea.x + eb.x) / 2;
      [ea, eb] = [
        { x, y: ea.y },
        { x, y: eb.y },
      ];
    }
    const merged: DetectedWall = {
      ...w1,
      a: ea,
      b: eb,
      thickness:
        (w1.thickness * segLength(w1) + w2.thickness * segLength(w2)) / (segLength(w1) + segLength(w2)),
      confidence: Math.min(w1.confidence, w2.confidence),
      coverage: (w1.coverage + w2.coverage) / 2,
      ends: [
        lo === 0 ? w1.ends[0] : along(w1, w2.a) < along(w1, w2.b) ? w2.ends[0] : w2.ends[1],
        hi === segLength(w1) ? w1.ends[1] : along(w1, w2.a) > along(w1, w2.b) ? w2.ends[0] : w2.ends[1],
      ],
    };
    const shift = (o: Omit<DetectedOpening, 'wallId' | 'id'>, src: DetectedWall) => {
      const ta = along(merged, pointAt(src, o.from));
      const tb = along(merged, pointAt(src, o.to));
      const flip = ta > tb;
      const sameNormal = segNormal(src).x * segNormal(merged).x + segNormal(src).y * segNormal(merged).y > 0;
      return {
        ...o,
        from: Math.min(ta, tb),
        to: Math.max(ta, tb),
        ...(o.hinge
          ? { hinge: (flip ? (o.hinge === 'start' ? 'end' : 'start') : o.hinge) as 'start' | 'end' }
          : {}),
        ...(o.swingSide ? { swingSide: (sameNormal ? o.swingSide : -o.swingSide) as 1 | -1 } : {}),
      };
    };
    const ops = [...getOps(w1).map((o) => shift(o, w1)), ...getOps(w2).map((o) => shift(o, w2))];
    for (const o of extra) ops.push(shift(o, w1));
    walls = walls.filter((x) => x !== w1 && x !== w2).concat([merged]);
    openings.delete(w1);
    openings.delete(w2);
    openings.set(merged, ops);
    return merged;
  };

  const classify = (
    w: DetectedWall,
    from: number,
    to: number,
    kind: Gap['kind'],
  ): Omit<DetectedOpening, 'wallId' | 'id'> | null => {
    const door = scoreDoor(ctx, w, from, to);
    const win = scoreWindow(ctx, w, from, to);
    const width = to - from;
    const evidence = { door: +door.score.toFixed(3), window: +win.toFixed(3) };
    // Plausible door widths relative to the plan's own wall thickness (no metric scale yet).
    const doorFits = width <= (door.kind === 'double' ? 10 : 6.5) * ctx.profile.major;
    if (door.score >= doorT && door.score >= win && doorFits) {
      const clear = clearOpening(ctx, w, from, to);
      return {
        kind: 'door',
        doorKind: door.kind,
        from: clear.from,
        to: clear.to,
        hinge: door.hinge,
        swingSide: door.side,
        swingConfidence: door.swingConfidence,
        confidence: +Math.min(0.97, door.score).toFixed(3),
        evidence,
      };
    }
    if (win >= winT)
      return { kind: 'window', from, to, confidence: +Math.min(0.95, win).toFixed(3), evidence };
    // Two walls on one line with a symbol-less gap: probably a doorway, but not certain.
    if (kind === 'collinear' && width <= 8 * ctx.profile.major)
      return { kind: 'opening', from, to, confidence: 0.45, evidence };
    return null;
  };
  const splitAtFill = (w: DetectedWall, from: number, to: number): [number, number][] => {
    const minRun = Math.max(3, 0.5 * w.thickness);
    const spans: [number, number][] = [];
    let start = from;
    let runStart = NaN;
    for (let t = from + 1; t <= to - 1; t += 1) {
      const fill = onMask(ctx.wallMask, pointAt(w, t));
      if (fill && Number.isNaN(runStart)) runStart = t;
      if (!fill && !Number.isNaN(runStart)) {
        if (t - runStart >= minRun && runStart - start > 2) {
          spans.push([start, runStart]);
          start = t;
        }
        runStart = NaN;
      }
    }
    spans.push([start, to]);
    return spans;
  };

  // 1. Gaps: classify and bridge, closest gaps first. A work queue: after a merge only the
  //    changed wall's gaps are recomputed; gaps whose walls no longer exist are re-derived.
  const rejected = new Set<string>();
  const extended = new Set<string>();
  const width = (g: Gap) => g.to - g.from;
  const queue: Gap[] = findGaps(walls, ctx.profile, ctx.wallMask).sort((p, q) => width(p) - width(q));
  const enqueue = (gs: Gap[]) => {
    for (const g of gs) {
      let lo = 0;
      let hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (width(queue[mid]!) <= width(g)) lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, g);
    }
  };
  let alive = new Set(walls);
  for (let guard = 0; queue.length && guard < 20 * wallsIn.length + 100; guard++) {
    const g = queue.shift()!;
    if (!alive.has(g.w1)) continue;
    if (!alive.has(g.w2)) {
      enqueue(findGaps(walls, ctx.profile, ctx.wallMask, [g.w1]).filter((h) => h.end === g.end));
      continue;
    }
    if (rejected.has(`${g.kind}|${g.w1.id}|${g.end}|${g.w2.id}`)) continue;
    // A short piece of wall fill inside the gap (e.g. between a door and a window) splits it:
    // each part is classified on its own.
    const spans =
      g.kind === 'collinear' ? splitAtFill(g.w1, g.from, g.to) : [[g.from, g.to] as [number, number]];
    const classified = spans.map(([from, to]) => classify(g.w1, from, to, g.kind));
    if (classified.some((op) => !op)) {
      rejected.add(`${g.kind}|${g.w1.id}|${g.end}|${g.w2.id}`);
      continue;
    }
    const ops = classified as Omit<DetectedOpening, 'wallId' | 'id'>[];
    const op = ops[0]!;
    if (g.kind === 'collinear') {
      const merged = mergeCollinear(g.w1, g.w2, ops);
      alive = new Set(walls);
      enqueue(findGaps(walls, ctx.profile, ctx.wallMask, [merged]));
    } else {
      // Extend w1 to the centreline of the wall it meets (a T-junction) across the opening —
      // once per wall end, and only if that centreline lies just past where the fill was hit
      // (allowing for a short stub between the gap and the wall).
      const x = intersectLines(g.w1, g.w2);
      const endKey = `${g.w1.id}|${g.end}`;
      const reach = x ? (g.end === 'a' ? -along(g.w1, x) : along(g.w1, x) - segLength(g.w1)) : NaN;
      if (
        !x ||
        extended.has(endKey) ||
        !(reach >= width(g) - 2 && reach <= width(g) + 3 * ctx.profile.major + g.w2.thickness)
      ) {
        rejected.add(`${g.kind}|${g.w1.id}|${g.end}|${g.w2.id}`);
        continue;
      }
      extended.add(endKey);
      const ext = {
        ...g.w1,
        [g.end]: x,
        ends: (g.end === 'a'
          ? ['junction', g.w1.ends[1]]
          : [g.w1.ends[0], 'junction']) as DetectedWall['ends'],
      };
      const offset = g.end === 'a' ? along(g.w1, x) : 0; // shift of the a-end (negative when extended at a)
      const o = { ...op, from: op.from - offset, to: op.to - offset };
      walls = walls.map((w) => (w === g.w1 ? ext : w));
      openings.set(ext, [
        ...getOps(g.w1).map((q) => ({ ...q, from: q.from - offset, to: q.to - offset })),
        o,
      ]);
      openings.delete(g.w1);
      alive = new Set(walls);
      enqueue(findGaps(walls, ctx.profile, ctx.wallMask, [ext]));
    }
  }

  // 2. Partially filled walls: a thin piece lying inside the band of a thick collinear wall,
  //    with glazing lines in the empty part of the band, is the same wall with a window.
  for (let changed = true, guard = 0; changed && guard < 200; guard++) {
    changed = false;
    for (const thin of walls) {
      const thick = walls.find(
        (o) =>
          o !== thin &&
          o.thickness > thin.thickness * 1.35 &&
          Math.abs(segDir(o).x * segDir(thin).x + segDir(o).y * segDir(thin).y) >
            Math.cos((3 * Math.PI) / 180) &&
          lineDistance(o, mul(addv(thin.a, thin.b), 0.5)) <= (o.thickness - thin.thickness) / 2 + 1.5,
      );
      if (!thick) continue;
      const ta = [along(thick, thin.a), along(thick, thin.b)].sort((x, y) => x - y) as [number, number];
      const L = segLength(thick);
      if (ta[0] > L + thick.thickness || ta[1] < -thick.thickness) continue; // not adjacent
      const thinSide =
        Math.sign(
          (thin.a.x - thick.a.x) * segNormal(thick).x + (thin.a.y - thick.a.y) * segNormal(thick).y,
        ) || 1;
      const [lo, hi] = [Math.max(ta[0], -1e9), ta[1]];
      const win = scoreWindow(ctx, thick, lo, hi, -thinSide as 1 | -1);
      if (win < winT) continue;
      // Keep the thick wall's line and thickness; the thin stretch becomes the window.
      const glazing = glazingExtent(ctx, thick, lo, hi, -thinSide as 1 | -1);
      const winFrom = glazing?.from ?? Math.max(lo, 0) + 0.15 * thick.thickness;
      const winTo = glazing?.to ?? Math.min(hi, Math.max(L, hi)) - 0.15 * thick.thickness;
      const merged = mergeCollinear(thick, thin, []);
      merged.thickness = thick.thickness;
      const shiftT = along(merged, pointAt(thick, 0));
      getOps(merged).push({
        kind: 'window',
        from: winFrom + shiftT,
        to: winTo + shiftT,
        confidence: +Math.min(0.9, win * 0.9).toFixed(3),
        evidence: { door: 0, window: +win.toFixed(3) },
      });
      changed = true;
      break;
    }
  }

  // 3. Doors drawn across continuous wall fill: scan wall faces for leaf + arc symbols.
  const doorWidths = [...openings.values()]
    .flat()
    .filter((o) => o.kind === 'door' && o.doorKind === 'hinged')
    .map((o) => o.to - o.from);
  const typical = doorWidths.length
    ? doorWidths.sort((x, y) => x - y)[Math.floor(doorWidths.length / 2)]!
    : 3.6 * ctx.profile.major;
  // Only when real door symbols in gaps give a reference width: without one, a plan full of
  // linework would turn every arc-like stroke along a line into a "door".
  for (const w of doorWidths.length >= 2 ? walls : []) {
    const L = segLength(w);
    const ops = getOps(w);
    const found: Omit<DetectedOpening, 'wallId' | 'id'>[] = [];
    for (let t = 0; t + 0.7 * typical <= L; t += 2) {
      for (const f of [0.85, 1, 1.15]) {
        const r = typical * f;
        if (t + r > L) continue;
        if ([...ops, ...found].some((o) => Math.min(o.to, t + r) - Math.max(o.from, t) > 0)) continue;
        // Only where the wall is solid across the span (gaps were handled above).
        let solid = 0;
        for (let k = 0; k <= 8; k++) if (onMask(ctx.wallMask, pointAt(w, t + (r * k) / 8))) solid++;
        if (solid < 8) continue;
        const fit = scoreDoor(ctx, w, t, t + r);
        // No gap supports this door, so the symbol itself must be unambiguous.
        if (
          fit.kind === 'hinged' &&
          fit.score >= 0.85 &&
          arcContinuity(ctx, w, fit, t, t + r) >= 0.8 &&
          sectorClear(ctx, w, fit, t, t + r) >= 0.95
        ) {
          found.push({
            kind: 'door',
            doorKind: 'hinged',
            from: t,
            to: t + r,
            hinge: fit.hinge,
            swingSide: fit.side,
            swingConfidence: fit.swingConfidence,
            confidence: +(fit.score * 0.85).toFixed(3),
            evidence: { door: +fit.score.toFixed(3), window: 0 },
          });
        }
      }
    }
    // Non-maximum suppression: keep the strongest of overlapping detections.
    found.sort((p, q) => q.evidence.door - p.evidence.door);
    const kept: typeof found = [];
    for (const f of found)
      if (!kept.some((k) => Math.min(k.to, f.to) - Math.max(k.from, f.from) > 0)) kept.push(f);
    openings.set(w, [...ops, ...kept]);
  }

  // Ids and output.
  const finalWalls = walls
    .sort((p, q) => (p.a.y + p.b.y) / 2 - (q.a.y + q.b.y) / 2 || (p.a.x + p.b.x) / 2 - (q.a.x + q.b.x) / 2)
    .map((w, i) => ({ ...w, id: `w${i + 1}`, _src: w }));
  const out: DetectedOpening[] = [];
  let di = 0;
  let wi = 0;
  let oi = 0;
  for (const w of finalWalls) {
    for (const o of (openings.get(w._src) ?? []).sort((p, q) => p.from - q.from)) {
      const id = o.kind === 'door' ? `d${++di}` : o.kind === 'window' ? `win${++wi}` : `o${++oi}`;
      out.push({ ...o, id, wallId: w.id, from: +o.from.toFixed(2), to: +o.to.toFixed(2) });
    }
  }
  return {
    walls: finalWalls.map(({ _src: _ignored, ...w }) => w),
    openings: out,
  };
}
