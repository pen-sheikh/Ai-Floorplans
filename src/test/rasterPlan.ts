import type { FloorPlanAnnotations, PxPoint } from '../floorplan/annotationTypes';
import { fillPolygon, newMask, type RgbaImage } from '../floorplan/cv/raster';
import {
  DEFAULT_PLAN_STYLE,
  planPrimitives,
  type PlanPrimitive,
  type PlanStyle,
} from '../floorplan/fixtures/render/planSvg';

/**
 * Test-only rasteriser for plan drawings (no anti-aliasing, no text): lets unit tests draw a
 * plan from known annotations and run the extractor on it without a browser.
 */
export function blankImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

const grey = (css: string): number => {
  const hex = css.replace('#', '');
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
};

export function paintPolygon(img: RgbaImage, points: readonly PxPoint[], value: number): void {
  const m = newMask(img.width, img.height);
  fillPolygon(m, points);
  for (let i = 0; i < m.data.length; i++) {
    if (!m.data[i]) continue;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = value;
  }
}

export function paintLine(img: RgbaImage, a: PxPoint, b: PxPoint, width: number, value: number): void {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-9) return;
  const w = Math.max(1, width) / 2;
  // Extend by half the width so joined strokes have no gaps at corners.
  const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const n = { x: -d.y * w, y: d.x * w };
  const a2 = { x: a.x - d.x * w, y: a.y - d.y * w };
  const b2 = { x: b.x + d.x * w, y: b.y + d.y * w };
  paintPolygon(
    img,
    [
      { x: a2.x + n.x, y: a2.y + n.y },
      { x: b2.x + n.x, y: b2.y + n.y },
      { x: b2.x - n.x, y: b2.y - n.y },
      { x: a2.x - n.x, y: a2.y - n.y },
    ],
    value,
  );
}

/** Arc from `from` to `to` around `center`, the short way round. */
export function paintArc(
  img: RgbaImage,
  center: PxPoint,
  r: number,
  from: PxPoint,
  to: PxPoint,
  width: number,
  value: number,
): void {
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  let a1 = Math.atan2(to.y - center.y, to.x - center.x);
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
  const steps = Math.max(8, Math.ceil((Math.abs(a1 - a0) * r) / 2));
  let prev = from;
  for (let k = 1; k <= steps; k++) {
    const t = a0 + ((a1 - a0) * k) / steps;
    const p = { x: center.x + Math.cos(t) * r, y: center.y + Math.sin(t) * r };
    paintLine(img, prev, p, width, value);
    prev = p;
  }
}

export function paintPrimitives(img: RgbaImage, prims: PlanPrimitive[]): RgbaImage {
  for (const p of prims) {
    if (p.kind === 'polygon') {
      if (p.fill && p.fill !== 'none') paintPolygon(img, p.points, grey(p.fill));
      if (p.stroke)
        p.points.forEach((q, i) =>
          paintLine(img, q, p.points[(i + 1) % p.points.length]!, p.strokeWidth ?? 1, grey(p.stroke!)),
        );
    } else if (p.kind === 'line') paintLine(img, p.a, p.b, p.width, grey(p.stroke));
    else if (p.kind === 'arc') paintArc(img, p.center, p.r, p.from, p.to, p.width, grey(p.stroke));
  }
  return img;
}

/** Draw a plan's walls, openings and dimension lines (text is supplied by a fake OCR instead). */
export function rasterPlan(ann: FloorPlanAnnotations, style: PlanStyle = DEFAULT_PLAN_STYLE): RgbaImage {
  return paintPrimitives(blankImage(ann.image.widthPx, ann.image.heightPx), planPrimitives(ann, style));
}
