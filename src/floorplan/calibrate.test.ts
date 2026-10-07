import { describe, expect, it } from 'vitest';
import type { AnnotatedRoom } from './annotationTypes';
import {
  CalibrationError,
  calibrateAnnotations,
  calibrateFromReferences,
  manualCalibration,
} from './calibrate';
import { E2_ANNOTATIONS } from './fixtures/e2/annotations';

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

describe('scale calibration (generic)', () => {
  it('derives px/m from printed dimensions and grades confidence', () => {
    const cal = calibrateAnnotations({ rooms: [room('a', [[2, 0, 200]]), room('b', [[3, 0, 300]])] });
    expect(cal.pixelsPerMeter).toBeCloseTo(100);
    expect(cal.maxResidual).toBeCloseTo(0);
    expect(cal.confidence).toBe('medium');
    expect(cal.samples.map((s) => s.referenceId)).toEqual(['a#0', 'b#0']);
  });

  it('rejects a mislabelled dimension instead of averaging it in', () => {
    const cal = calibrateFromReferences([
      { id: 'a', meters: 2, measuredPx: 200 },
      { id: 'b', meters: 3, measuredPx: 300 },
      { id: 'c', meters: 4, measuredPx: 400 },
      { id: 'typo', meters: 2, measuredPx: 260 },
    ]);
    expect(cal.pixelsPerMeter).toBeCloseTo(100);
    expect(cal.samples.find((s) => s.referenceId === 'typo')!.accepted).toBe(false);
    expect(cal.confidence).toBe('high');
  });

  it('uses free-standing dimension lines at any angle', () => {
    const cal = calibrateAnnotations({
      rooms: [],
      calibration: { references: [{ id: 'diag', meters: 5, a: { x: 0, y: 0 }, b: { x: 300, y: 400 } }] },
    });
    expect(cal.pixelsPerMeter).toBeCloseTo(100);
    expect(cal.confidence).toBe('low'); // a single reference cannot be cross-checked
  });

  it('falls back to a manual scale, flagged low-confidence', () => {
    const cal = calibrateAnnotations({ rooms: [], calibration: { manualPixelsPerMeter: 50 } });
    expect(cal).toMatchObject({ pixelsPerMeter: 50, method: 'manual', confidence: 'low' });
  });

  it('refuses to guess a scale without information', () => {
    expect(() => calibrateAnnotations({ rooms: [room('a', [])] })).toThrow(CalibrationError);
    expect(() => manualCalibration(0)).toThrow(CalibrationError);
  });
});

describe('scale calibration (E2 reference)', () => {
  it('calibrates E2 consistently (≈88 px/m, high confidence) and flags the Bedroom 2 width', () => {
    const cal = calibrateAnnotations(E2_ANNOTATIONS);
    expect(cal.pixelsPerMeter).toBeGreaterThan(87.5);
    expect(cal.pixelsPerMeter).toBeLessThan(88.8);
    expect(cal.confidence).toBe('high');
    const rejected = cal.samples.filter((s) => !s.accepted);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ roomId: 'bedroom-2', labelMeters: 2.61 });
  });
});
