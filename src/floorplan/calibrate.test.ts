import { describe, expect, it } from 'vitest';
import { PACKENHAM_HOUSE_E2 } from './annotations/packenhamHouseE2';
import type { AnnotatedRoom } from './annotationTypes';
import { CalibrationError, calibrateFromDimensions, manualCalibration } from './calibrate';

const room = (id: string, dims: [number, number, number][]): AnnotatedRoom => ({
  id,
  name: id,
  type: 'bedroom',
  labelSource: 'plan-label',
  polygon: [],
  dimensions: dims.map(([meters, from, to]) => ({
    meters,
    axis: 'x' as const,
    span: [from, to] as [number, number],
  })),
});

describe('scale calibration', () => {
  it('derives px/m from printed dimensions', () => {
    const cal = calibrateFromDimensions([room('a', [[2, 0, 200]]), room('b', [[3, 0, 300]])]);
    expect(cal.pixelsPerMeter).toBeCloseTo(100);
    expect(cal.maxResidual).toBeCloseTo(0);
  });

  it('rejects a mislabelled dimension instead of averaging it in', () => {
    const cal = calibrateFromDimensions([
      room('a', [
        [2, 0, 200],
        [3, 0, 300],
      ]),
      room('b', [
        [4, 0, 400],
        [2, 0, 260],
      ]),
    ]);
    expect(cal.pixelsPerMeter).toBeCloseTo(100);
    expect(cal.samples.find((s) => s.measuredPx === 260)!.accepted).toBe(false);
  });

  it('calibrates the E2 plan consistently (≈88 px/m) and flags the Bedroom 2 width label', () => {
    const cal = calibrateFromDimensions(PACKENHAM_HOUSE_E2.rooms);
    expect(cal.pixelsPerMeter).toBeGreaterThan(87.5);
    expect(cal.pixelsPerMeter).toBeLessThan(88.8);
    expect(cal.maxResidual).toBeLessThan(0.01);
    const rejected = cal.samples.filter((s) => !s.accepted);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ roomId: 'bedroom-2', labelMeters: 2.61 });
  });

  it('refuses to guess a scale without information', () => {
    expect(() => calibrateFromDimensions([room('a', [])])).toThrow(CalibrationError);
    expect(() => manualCalibration(0)).toThrow(CalibrationError);
    expect(manualCalibration(50)).toMatchObject({ pixelsPerMeter: 50, method: 'manual' });
  });
});
