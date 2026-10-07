import { distanceTransform } from './morphology';
import type { ThicknessProfile } from './preprocess';
import { newMask, type GrayImage, type Mask } from './raster';
import {
  along,
  intersectLines,
  lineDistance,
  lineSegments,
  onMask,
  segDir,
  segLength,
  segNormal,
  type DetectedWall,
  type Pt,
} from './walls';

/**
 * Railings, balustrades and other light partitions are often drawn as a hollow band: two
 * parallel thin lines with paper between them, rather than solid wall fill. A band is accepted
 * only when (1) both lines run together for a good length, (2) the space between them is
 * empty, and (3) BOTH ends connect to the wall structure or to another band — so pairs of lines
 * in furniture, fittings or text are not mistaken for structure.
 */
export interface HollowBandContext {
  gray: GrayImage;
  wallMask: Mask;
  lineThreshold: number;
  profile: ThicknessProfile;
}

const addv = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });

export function detectHollowBands(ctx: HollowBandContext, walls: DetectedWall[]): DetectedWall[] {
  const { gray, wallMask, lineThreshold, profile } = ctx;
  const W = gray.width;
  const H = gray.height;
  // Thin linework away from wall fill (anti-aliased wall edges would pair up with each other).
  const notWall = newMask(W, H);
  for (let i = 0; i < notWall.data.length; i++) notWall.data[i] = wallMask.data[i] ? 0 : 1;
  const toWall = distanceTransform(notWall);
  const thin = newMask(W, H);
  for (let i = 0; i < thin.data.length; i++)
    thin.data[i] = gray.data[i]! < lineThreshold && toWall[i]! > 2 ? 1 : 0;
  const paperAt = (p: Pt) => {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return (
      x >= 0 &&
      y >= 0 &&
      x < W &&
      y < H &&
      gray.data[y * W + x]! >= lineThreshold &&
      !wallMask.data[y * W + x]
    );
  };
  const inkNear = (p: Pt) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (onMask(thin, { x: p.x + dx, y: p.y + dy })) return true;
    return false;
  };

  const minLen = 3 * profile.major;
  const lines = lineSegments(thin, minLen);
  const sepMin = 0.3 * profile.major;
  const sepMax = 1.2 * profile.major;
  const cosTol = Math.cos((3 * Math.PI) / 180);

  // 1. Pair parallel lines at band spacing; keep the stretch where both run together.
  let bands: { a: Pt; b: Pt; sep: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const l1 = lines[i]!;
      const l2 = lines[j]!;
      const d1 = segDir(l1);
      if (Math.abs(d1.x * segDir(l2).x + d1.y * segDir(l2).y) < cosTol) continue;
      const sep = lineDistance(l1, mul(addv(l2.a, l2.b), 0.5));
      if (sep < sepMin || sep > sepMax) continue;
      const t2 = [along(l1, l2.a), along(l1, l2.b)].sort((x, y) => x - y) as [number, number];
      const t0 = Math.max(0, t2[0]);
      const t1 = Math.min(segLength(l1), t2[1]);
      if (t1 - t0 < Math.max(minLen, 0.7 * Math.min(segLength(l1), segLength(l2)))) continue;
      const n = segNormal(l1);
      const side = Math.sign((l2.a.x - l1.a.x) * n.x + (l2.a.y - l1.a.y) * n.y) || 1;
      const off = mul(n, (side * sep) / 2);
      const a = addv(addv(l1.a, mul(d1, t0)), off);
      const b = addv(addv(l1.a, mul(d1, t1)), off);
      // 2. Hollow: paper on the centre line, a line on each side, all along.
      let ok = 0;
      let total = 0;
      for (let t = 0; t <= t1 - t0; t += 2) {
        total++;
        const c = addv(a, mul(d1, t));
        if (
          paperAt(c) &&
          inkNear(addv(c, mul(n, (side * sep) / 2))) &&
          inkNear(addv(c, mul(n, (-side * sep) / 2)))
        )
          ok++;
      }
      if (ok / total >= 0.85) bands.push({ a, b, sep });
    }
  }
  // Fragments of one band (a line split by a junction) become one.
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < bands.length; i++) {
      for (let j = i + 1; j < bands.length; j++) {
        const p = bands[i]!;
        const q = bands[j]!;
        const dp = segDir(p);
        if (Math.abs(dp.x * segDir(q).x + dp.y * segDir(q).y) < cosTol) continue;
        if (lineDistance(p, mul(addv(q.a, q.b), 0.5)) > 0.5 * p.sep) continue;
        const ts = [0, segLength(p), along(p, q.a), along(p, q.b)];
        const tq = [ts[2]!, ts[3]!].sort((x, y) => x - y);
        if (tq[0]! > segLength(p) + 3 || tq[1]! < -3) continue;
        const lo = Math.min(...ts);
        const hi = Math.max(...ts);
        bands[i] = { a: addv(p.a, mul(dp, lo)), b: addv(p.a, mul(dp, hi)), sep: (p.sep + q.sep) / 2 };
        bands.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }

  // 3. Ends: extend to the wall fill they meet, or to the corner with another band.
  const reach = 1.5 * profile.major;
  const result: DetectedWall[] = [];
  const ends: { band: number; end: 'a' | 'b'; connected: boolean }[] = [];
  bands = bands.map((band) => ({ ...band }));
  bands.forEach((band, bi) => {
    for (const end of ['a', 'b'] as const) {
      const dir = end === 'b' ? segDir(band) : mul(segDir(band), -1);
      let connected = false;
      for (let s = 0; s <= reach; s += 0.5) {
        const p = addv(band[end], mul(dir, s));
        if (onMask(wallMask, p)) {
          band[end] = p;
          connected = true;
          break;
        }
      }
      if (!connected) {
        for (const [k, other] of bands.entries()) {
          if (k === bi) continue;
          const x = intersectLines(band, other);
          if (!x) continue;
          const dEnd = Math.hypot(x.x - band[end].x, x.y - band[end].y);
          const dOther = Math.min(
            Math.hypot(x.x - other.a.x, x.y - other.a.y),
            Math.hypot(x.x - other.b.x, x.y - other.b.y),
          );
          if (dEnd <= reach && dOther <= reach) {
            band[end] = x;
            connected = true;
            break;
          }
        }
      }
      ends.push({ band: bi, end, connected });
    }
  });
  // Free-standing pairs of lines (furniture, fittings) are not structure.
  bands.forEach((band, bi) => {
    if (!ends.filter((e) => e.band === bi).every((e) => e.connected)) return;
    // Do not duplicate a wall already found as solid fill along the same line.
    const mid = mul(addv(band.a, band.b), 0.5);
    const duplicate = walls.some(
      (w) =>
        Math.abs(segDir(w).x * segDir(band).x + segDir(w).y * segDir(band).y) > cosTol &&
        lineDistance(w, mid) < w.thickness &&
        along(w, mid) > 0 &&
        along(w, mid) < segLength(w),
    );
    if (duplicate) return;
    result.push({
      id: `rail${result.length + 1}`,
      a: band.a,
      b: band.b,
      thickness: +(band.sep + 1).toFixed(2),
      ends: ['junction', 'junction'],
      coverage: 1,
      confidence: 0.75,
    });
  });
  return result;
}
