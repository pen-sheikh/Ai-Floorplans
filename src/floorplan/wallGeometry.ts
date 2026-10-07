import type { AnnotatedWall, PxPoint, PxRect } from './annotationTypes';

/** A wall centreline in image pixels, oriented so its dominant coordinate increases a → b. */
export interface PxWallGeometry {
  a: PxPoint;
  b: PxPoint;
  thicknessPx: number;
  lengthPx: number;
  /** Unit direction a → b. */
  dir: PxPoint;
  /** Axis the wall is closer to; opening spans are measured on it. */
  dominant: 'x' | 'y';
}

export class WallGeometryError extends Error {}

/** Long-axis description of an axis-aligned wall rectangle. */
export function wallAxis(rect: PxRect) {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  if (!(w > 0) || !(h > 0)) throw new WallGeometryError(`Degenerate wall rectangle ${JSON.stringify(rect)}`);
  return w >= h
    ? {
        axis: 'x' as const,
        startPx: rect.x0,
        endPx: rect.x1,
        centerPx: (rect.y0 + rect.y1) / 2,
        thicknessPx: h,
      }
    : {
        axis: 'y' as const,
        startPx: rect.y0,
        endPx: rect.y1,
        centerPx: (rect.x0 + rect.x1) / 2,
        thicknessPx: w,
      };
}

export function pxWallGeometry(w: AnnotatedWall): PxWallGeometry {
  let a: PxPoint;
  let b: PxPoint;
  let thicknessPx: number;
  if ('rect' in w) {
    const ax = wallAxis(w.rect);
    a = ax.axis === 'x' ? { x: ax.startPx, y: ax.centerPx } : { x: ax.centerPx, y: ax.startPx };
    b = ax.axis === 'x' ? { x: ax.endPx, y: ax.centerPx } : { x: ax.centerPx, y: ax.endPx };
    thicknessPx = ax.thicknessPx;
  } else {
    ({ a, b, thicknessPx } = w.segment);
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthPx = Math.hypot(dx, dy);
  if (!(lengthPx > 0)) throw new WallGeometryError(`Wall ${w.id} has zero length`);
  if (!(thicknessPx > 0)) throw new WallGeometryError(`Wall ${w.id} has no thickness`);
  const dominant = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
  // Orient so the dominant coordinate increases from a to b (makes hinge 'min'/'max' well defined).
  if ((dominant === 'x' ? dx : dy) < 0) [a, b] = [b, a];
  const dir = { x: (b.x - a.x) / lengthPx, y: (b.y - a.y) / lengthPx };
  return { a, b, thicknessPx, lengthPx, dir, dominant };
}

/**
 * Convert an opening span (absolute dominant-axis coordinates) to distances along the wall
 * centreline from `a`, in pixels.
 */
export function spanAlongWall(g: PxWallGeometry, span: [number, number]): { from: number; to: number } {
  const [s0, s1] = span[0] <= span[1] ? span : [span[1], span[0]];
  const d = g.dominant === 'x' ? g.dir.x : g.dir.y; // ≥ cos 45°
  const origin = g.dominant === 'x' ? g.a.x : g.a.y;
  return { from: (s0 - origin) / d, to: (s1 - origin) / d };
}
