import type { ThicknessProfile } from './preprocess';
import { SegmentGrid } from './spatial';
import { along, lineDistance, segLength, type DetectedWall } from './walls';

export interface StructureAssessment {
  /** Walls kept, with confidence reduced for doubtful ones. */
  walls: DetectedWall[];
  /** Removed as non-structural (furniture, symbols, texture, isolated strokes). */
  removed: DetectedWall[];
  /** Kept but doubtful: may be annotation, furniture or dimension lines. */
  doubtful: DetectedWall[];
}

/**
 * Structural walls versus everything else drawn with heavy ink (furniture, fittings, symbols,
 * textures, bold annotations). General evidence only:
 *  - thickness: walls come in a few consistent classes;
 *  - connectivity: walls meet other walls; furniture and symbols float;
 *  - proportion: a wall is long relative to its thickness;
 *  - the network: walls form one large connected structure (or a few, e.g. two flats drawn
 *    side by side); small detached clusters are objects drawn inside rooms.
 */
export function assessStructure(walls: DetectedWall[], profile: ThicknessProfile): StructureAssessment {
  if (!walls.length) return { walls, removed: [], doubtful: [] };
  const grid = new SegmentGrid(walls, Math.max(24, 4 * profile.major), profile.major);
  // Wall graph: connected clusters.
  const index = new Map(walls.map((w, i) => [w, i]));
  const parent = walls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const endLinks = walls.map(() => 0);
  walls.forEach((w, i) => {
    for (const p of [w.a, w.b]) {
      let linked = false;
      for (const o of grid.near(p, profile.major)) {
        if (o === w) continue;
        if (
          lineDistance(o, p) <= o.thickness / 2 + w.thickness / 2 + 2 &&
          along(o, p) >= -o.thickness &&
          along(o, p) <= segLength(o) + o.thickness
        ) {
          parent[find(index.get(o)!)] = find(i);
          linked = true;
        }
      }
      if (linked) endLinks[i]!++;
    }
  });
  const clusterLen = new Map<number, number>();
  walls.forEach((w, i) => clusterLen.set(find(i), (clusterLen.get(find(i)) ?? 0) + segLength(w)));
  const largest = Math.max(...clusterLen.values());
  // Clusters that look like lettering or symbols: several short strokes, some oblique, in a
  // compact area (large bold text and furniture glyphs survive the wall filter otherwise).
  const members = new Map<number, DetectedWall[]>();
  walls.forEach((w, i) => members.set(find(i), [...(members.get(find(i)) ?? []), w]));
  const glyphLike = new Set<number>();
  for (const [root, list] of members) {
    if (list.length < 3) continue;
    const xs = list.flatMap((w) => [w.a.x, w.b.x]);
    const ys = list.flatMap((w) => [w.a.y, w.b.y]);
    const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const short =
      list.filter((w) => segLength(w) < Math.max(6 * w.thickness, 2.5 * profile.major)).length / list.length;
    const oblique = list.filter((w) => {
      const dx = Math.abs(w.b.x - w.a.x);
      const dy = Math.abs(w.b.y - w.a.y);
      return Math.min(dx, dy) > 0.2 * Math.max(dx, dy);
    }).length;
    if (diag < 10 * profile.major && short >= 0.7 && oblique >= 1) glyphLike.add(root);
  }

  const kept: DetectedWall[] = [];
  const removed: DetectedWall[] = [];
  const doubtful: DetectedWall[] = [];
  walls.forEach((w, i) => {
    const L = segLength(w);
    const mode = profile.modes.reduce(
      (best, m) => (Math.abs(m - w.thickness) < Math.abs(best - w.thickness) ? m : best),
      profile.major,
    );
    // Thinner than a wall class is suspicious (linework); thicker solid pieces (piers,
    // columns, chimney breasts) are tolerated more.
    const classFit = Math.max(0, 1 - Math.abs(w.thickness - mode) / ((w.thickness > mode ? 1 : 0.5) * mode));
    const connectivity = endLinks[i]! / 2;
    const proportion = Math.min(1, L / (3 * w.thickness));
    const cluster = clusterLen.get(find(i))! / largest;
    const score = w.confidence * (0.5 + 0.5 * classFit) * (0.55 + 0.45 * connectivity) * proportion;
    // A detached cluster much smaller than the main structure is usually an object inside the
    // plan — but a solid piece of the right thickness can be real wall cut off by openings drawn
    // in colour or not at all, so only weak detached pieces are dropped; strong ones are doubtful.
    const detached = cluster < 0.15;
    const weak = score < 0.35 || classFit < 0.5;
    const isolatedWeak = connectivity === 0 && (weak || L < 3 * w.thickness);
    if ((detached && weak) || isolatedWeak || glyphLike.has(find(i))) {
      removed.push(w);
      return;
    }
    if (score < 0.45 || detached) {
      const d = { ...w, confidence: +Math.min(w.confidence, score + 0.1).toFixed(3) };
      doubtful.push(d);
      kept.push(d);
      return;
    }
    kept.push(w);
  });
  return { walls: kept, removed, doubtful };
}
