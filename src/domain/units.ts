import type { Provenance } from './types';

/** Values measured from drawn geometry or assumed are estimates and are shown with "≈". */
export const isEstimate = (source: Provenance): boolean => source !== 'plan-label' && source !== 'user';

/**
 * Lengths: the plan prints centimetres (2 dp) and one image pixel is ≈1.1 cm at the calibrated
 * scale, so 2 dp is the most precision we ever show. Assumed values get 1 dp.
 */
export function formatLength(meters: number, source: Provenance = 'plan-geometry'): string {
  const dp = source === 'assumed' ? 1 : 2;
  return `${isEstimate(source) ? '≈ ' : ''}${meters.toFixed(dp)} m`;
}

export function formatArea(m2: number, source: Provenance = 'plan-geometry'): string {
  return `${isEstimate(source) ? '≈ ' : ''}${m2.toFixed(1)} m²`;
}

export const formatDegrees = (radians: number): string => `${Math.round((radians * 180) / Math.PI)}°`;

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Normalise an angle to [0, 2π). */
export function normalizeAngle(rad: number): number {
  const t = rad % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}
