import type { CoordinateSystem, Vec2 } from './types';

/**
 * The ONLY place where plan-image pixels are converted to world metres and back.
 *
 *   Image (pixels)                 World (metres, Y up)
 *   +x ────────►                   +X ────────►
 *   │                              │
 *   ▼ +y                           ▼ +Z            (+Y points out of the screen, towards you)
 *
 *   world.x = (px.x − origin.x) / pixelsPerMeter
 *   world.z = (px.y − origin.y) / pixelsPerMeter
 *
 * Height (world Y) has no counterpart in the image; it comes from the model.
 */
export interface PlanTransform {
  originPx: { x: number; y: number };
  pixelsPerMeter: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export function planToWorld(p: PixelPoint, t: PlanTransform): Vec2 {
  return { x: (p.x - t.originPx.x) / t.pixelsPerMeter, z: (p.y - t.originPx.y) / t.pixelsPerMeter };
}

export function worldToPlan(p: Vec2, t: PlanTransform): PixelPoint {
  return { x: p.x * t.pixelsPerMeter + t.originPx.x, y: p.z * t.pixelsPerMeter + t.originPx.y };
}

export const pxToMeters = (px: number, t: PlanTransform): number => px / t.pixelsPerMeter;

export function planTransformOf(cs: CoordinateSystem): PlanTransform | null {
  if (!cs.plan) return null;
  return { originPx: cs.plan.originPx, pixelsPerMeter: cs.plan.calibration.pixelsPerMeter };
}

/** World-space rectangle covered by the whole plan image (for the 3D overlay plane). */
export function planImageWorldRect(
  cs: CoordinateSystem,
): { center: Vec2; width: number; depth: number } | null {
  const t = planTransformOf(cs);
  if (!t || !cs.plan) return null;
  const { widthPx, heightPx } = cs.plan.image;
  const tl = planToWorld({ x: 0, y: 0 }, t);
  const br = planToWorld({ x: widthPx, y: heightPx }, t);
  return {
    center: { x: (tl.x + br.x) / 2, z: (tl.z + br.z) / 2 },
    width: br.x - tl.x,
    depth: br.z - tl.z,
  };
}
