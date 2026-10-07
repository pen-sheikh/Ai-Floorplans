import type { ScaleCalibration, ScaleSample } from '../domain/types';
import { dimensionPx, type AnnotatedDimension, type FloorPlanAnnotations } from './annotationTypes';

export interface CalibrationOptions {
  /** Samples further than this relative distance from the median are rejected. */
  outlierThreshold: number;
}

export const DEFAULT_CALIBRATION_OPTIONS: CalibrationOptions = { outlierThreshold: 0.03 };

export class CalibrationError extends Error {}

/** A printed length paired with the drawn distance it describes. */
export interface CalibrationReference {
  id: string;
  kind?: 'printed' | 'reference';
  roomId?: string;
  meters: number;
  measuredPx: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Collect every calibration reference in the annotations (room labels + dimension lines). */
export function calibrationReferences(
  ann: Pick<FloorPlanAnnotations, 'rooms' | 'calibration'>,
): CalibrationReference[] {
  const ref = (d: AnnotatedDimension, id: string, roomId?: string): CalibrationReference => ({
    id: d.id ?? id,
    kind: d.kind ?? 'printed',
    ...(roomId ? { roomId } : {}),
    meters: d.meters,
    measuredPx: dimensionPx(d),
  });
  return [
    ...ann.rooms.flatMap((r) => (r.dimensions ?? []).map((d, i) => ref(d, `${r.id}#${i}`, r.id))),
    ...(ann.calibration?.references ?? []).map((d, i) => ref(d, `dimension#${i}`)),
  ];
}

export function calibrationConfidence(
  accepted: number,
  maxResidual: number,
  method: ScaleCalibration['method'],
): ScaleCalibration['confidence'] {
  if (method === 'manual' || method === 'estimated') return 'low';
  // An explicit known measurement is trusted more than printed labels.
  if (method === 'reference') return accepted >= 2 && maxResidual <= 0.02 ? 'high' : 'medium';
  if (accepted >= 3 && maxResidual <= 0.02) return 'high';
  if (accepted >= 2 && maxResidual <= 0.05) return 'medium';
  return 'low';
}

/**
 * Derive pixels-per-metre from reference measurements. Each pair yields a px/m estimate; the
 * median is robust to a mislabelled dimension, samples far from it are rejected, and the
 * final scale is the mean of the accepted samples. Nothing here is specific to any plan.
 */
export function calibrateFromReferences(
  refs: readonly CalibrationReference[],
  options: CalibrationOptions = DEFAULT_CALIBRATION_OPTIONS,
): ScaleCalibration {
  const raw = refs.map((r) => {
    if (!(r.meters > 0) || !(r.measuredPx > 0)) {
      throw new CalibrationError(`Invalid reference ${r.id}: ${r.meters} m over ${r.measuredPx} px`);
    }
    return { ...r, pixelsPerMeter: r.measuredPx / r.meters };
  });
  if (raw.length === 0)
    throw new CalibrationError('No reference dimensions available; a manual scale is required.');

  const med = median(raw.map((s) => s.pixelsPerMeter));
  const accepted = raw.filter((s) => Math.abs(s.pixelsPerMeter / med - 1) <= options.outlierThreshold);
  if (accepted.length === 0)
    throw new CalibrationError('All reference dimensions disagree; cannot calibrate.');

  const ppm = accepted.reduce((acc, s) => acc + s.pixelsPerMeter, 0) / accepted.length;
  const samples: ScaleSample[] = raw.map((s) => ({
    referenceId: s.id,
    ...(s.roomId ? { roomId: s.roomId } : {}),
    labelMeters: s.meters,
    measuredPx: s.measuredPx,
    pixelsPerMeter: s.pixelsPerMeter,
    residual: (s.measuredPx / ppm - s.meters) / s.meters,
    accepted: accepted.includes(s),
  }));
  const maxResidual = Math.max(...samples.filter((s) => s.accepted).map((s) => Math.abs(s.residual)));
  const method = refs.every((r) => r.kind === 'reference') ? 'reference' : 'dimension-labels';
  return {
    pixelsPerMeter: ppm,
    method,
    samples,
    maxResidual,
    confidence: calibrationConfidence(accepted.length, maxResidual, method),
  };
}

/** Calibrate from annotations: references if present, otherwise the manual scale. */
export function calibrateAnnotations(
  ann: Pick<FloorPlanAnnotations, 'rooms' | 'calibration'>,
  options: CalibrationOptions = DEFAULT_CALIBRATION_OPTIONS,
): ScaleCalibration {
  // Priority: 1 explicit reference, 2 printed dimensions, 3 user scale, 4 estimate.
  const refs = calibrationReferences(ann);
  const explicit = refs.filter((r) => r.kind === 'reference');
  if (explicit.length) return calibrateFromReferences(explicit, options);
  if (refs.length) return calibrateFromReferences(refs, options);
  const manual = ann.calibration?.manualPixelsPerMeter;
  if (manual !== undefined) return manualCalibration(manual);
  const est = ann.calibration?.estimatedPixelsPerMeter;
  if (est) return estimatedCalibration(est.value, est.basis);
  throw new CalibrationError('No reference dimensions and no manual scale.');
}

/** A fallback scale from typical sizes. Always low confidence and labelled 'estimated'. */
export function estimatedCalibration(pixelsPerMeter: number, basis: string): ScaleCalibration {
  if (!(pixelsPerMeter > 0)) throw new CalibrationError('Estimated scale must be positive.');
  return { pixelsPerMeter, method: 'estimated', basis, samples: [], maxResidual: 0, confidence: 'low' };
}

export function manualCalibration(pixelsPerMeter: number): ScaleCalibration {
  if (!(pixelsPerMeter > 0)) throw new CalibrationError('Manual scale must be positive.');
  return { pixelsPerMeter, method: 'manual', samples: [], maxResidual: 0, confidence: 'low' };
}
