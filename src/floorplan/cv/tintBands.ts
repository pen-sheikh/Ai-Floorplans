import { distanceTransform, fillSmallHoles } from './morphology';
import type { Preprocessed, ThicknessProfile } from './preprocess';
import type { Mask } from './raster';
import { detectWalls, onMask, segDir, segLength, type DetectedWall } from './walls';

/**
 * Some plans draw windows (or glazed walls) as solid coloured bands in the wall line, with no
 * glazing lines. Colour areas are paper for structure detection, so such a window leaves an
 * open gap. Here the coloured areas are vectorised like walls; pieces that are wall-thick,
 * elongated and touch the inked wall structure are returned as walls that carry a window.
 * Floor tints and coloured furniture are blobs, far thicker than walls, and are not returned.
 */
export function detectTintBands(
  pre: Preprocessed,
  profile: ThicknessProfile,
  wallMask: Mask,
): DetectedWall[] {
  let any = 0;
  for (let i = 0; i < pre.tint.data.length && !any; i++) any = pre.tint.data[i]!;
  if (!any) return [];
  // Labels printed inside a band ("window") leave holes; close them so the band stays whole.
  const tint = fillSmallHoles(pre.tint, (2 * profile.major) ** 2);
  const pseudo: Preprocessed = { ...pre, ink: tint, inkDistance: distanceTransform(tint) };
  const { walls } = detectWalls(pseudo, profile);
  const touchesStructure = (w: DetectedWall) =>
    [w.a, w.b].some((p) => {
      const r = Math.ceil(w.thickness / 2 + 3);
      for (let dy = -r; dy <= r; dy += 2)
        for (let dx = -r; dx <= r; dx += 2) if (onMask(wallMask, { x: p.x + dx, y: p.y + dy })) return true;
      return false;
    });
  return walls
    .filter(
      (w) =>
        w.thickness >= 0.4 * profile.minor &&
        w.thickness <= 1.6 * profile.major &&
        segLength(w) >= 2 * w.thickness &&
        w.confidence >= 0.6 &&
        touchesStructure(w),
    )
    .map((w, i) => {
      // Extend to the band's own ends (vectorised walls stop half a thickness short), so the
      // band meets the walls it joins without a seam.
      const d = segDir(w);
      const e = w.thickness / 2;
      return {
        ...w,
        id: `tint${i + 1}`,
        a: { x: w.a.x - d.x * e, y: w.a.y - d.y * e },
        b: { x: w.b.x + d.x * e, y: w.b.y + d.y * e },
        confidence: +Math.min(w.confidence, 0.7).toFixed(3),
      };
    });
}
