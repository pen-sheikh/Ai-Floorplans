import type { ScaleCalibration, ScaleSample } from '../domain/types';
import type { AnnotatedRoom } from './annotationTypes';

export interface CalibrationOptions {
  /** Samples further than this relative distance from the median are rejected. */
  outlierThreshold: number;
}

export const DEFAULT_CALIBRATION_OPTIONS: CalibrationOptions = { outlierThreshold: 0.03 };

export class CalibrationError extends Error {}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Derive pixels-per-metre from printed room dimensions.
 *
 * Each printed length is paired (by the annotation) with the drawn span it describes.
 * Every pair yields a px/m estimate; the median is robust to a mislabelled room, samples far
 * from it are rejected, and the final scale is the mean of the accepted samples.
 */
export function calibrateFromDimensions(
  rooms: readonly AnnotatedRoom[],
  options: CalibrationOptions = DEFAULT_CALIBRATION_OPTIONS,
): ScaleCalibration {
  const raw = rooms.flatMap((room) =>
    (room.dimensions ?? []).map((d) => {
      const measuredPx = Math.abs(d.span[1] - d.span[0]);
      if (!(d.meters > 0) || !(measuredPx > 0)) {
        throw new CalibrationError(`Invalid dimension on ${room.id}: ${d.meters} m over ${measuredPx} px`);
      }
      return { roomId: room.id, labelMeters: d.meters, measuredPx, pixelsPerMeter: measuredPx / d.meters };
    }),
  );
  if (raw.length === 0) {
    throw new CalibrationError('No printed dimensions available; a manual scale is required.');
  }

  const med = median(raw.map((s) => s.pixelsPerMeter));
  const accepted = raw.filter((s) => Math.abs(s.pixelsPerMeter / med - 1) <= options.outlierThreshold);
  if (accepted.length === 0) throw new CalibrationError('All dimension samples disagree; cannot calibrate.');

  const ppm = accepted.reduce((acc, s) => acc + s.pixelsPerMeter, 0) / accepted.length;
  const samples: ScaleSample[] = raw.map((s) => ({
    ...s,
    residual: (s.measuredPx / ppm - s.labelMeters) / s.labelMeters,
    accepted: accepted.includes(s),
  }));
  const maxResidual = Math.max(...samples.filter((s) => s.accepted).map((s) => Math.abs(s.residual)));

  return { pixelsPerMeter: ppm, method: 'dimension-labels', samples, maxResidual };
}

export function manualCalibration(pixelsPerMeter: number): ScaleCalibration {
  if (!(pixelsPerMeter > 0)) throw new CalibrationError('Manual scale must be positive.');
  return { pixelsPerMeter, method: 'manual', samples: [], maxResidual: 0 };
}
