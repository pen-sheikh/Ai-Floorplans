import { describe, expect, it } from 'vitest';
import { SYNTHETIC_MM_ANNOTATIONS } from '../fixtures/synthetic-mm/annotations';
import type { ExtractionCalibrationReport } from '../extraction';
import { assessExtraction } from './review';

const measured: ExtractionCalibrationReport = {
  strategy: 'dimension-labels',
  pixelsPerMeter: 60,
  confidence: 'high',
  samplesUsed: 10,
  samplesRejected: 0,
};
const clean = {
  ...SYNTHETIC_MM_ANNOTATIONS,
  doors: SYNTHETIC_MM_ANNOTATIONS.doors.filter((d) => d.kind !== 'opening'),
};

describe('assessExtraction', () => {
  it('passes clean, confident annotations (only informational notes)', () => {
    const r = assessExtraction(clean, measured);
    expect(r.status).toBe('ok');
    expect(r.problems.every((p) => p.severity === 'info')).toBe(true);
  });

  it('asks for review when anything is uncertain, naming the elements', () => {
    const ann = {
      ...clean,
      walls: clean.walls.map((w, i) => (i === 0 ? { ...w, confidence: 0.4 } : w)),
      windows: clean.windows.map((w, i) => (i === 0 ? { ...w, confidence: 0.3 } : w)),
    };
    const r = assessExtraction(
      ann,
      { ...measured, strategy: 'estimated', confidence: 'low', basis: 'median of 3 detected door widths' },
      { unplacedLabels: ['BALCONY'] },
    );
    expect(r.status).toBe('needs-review');
    const codes = r.problems.map((p) => p.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'low-confidence-walls',
        'possible-window',
        'scale-estimated',
        'label-outside-rooms',
      ]),
    );
    expect(r.problems.find((p) => p.code === 'low-confidence-walls')?.elementIds).toEqual([
      clean.walls[0]!.id,
    ]);
  });

  it('fails when the annotations cannot make a valid model', () => {
    expect(assessExtraction({ ...clean, rooms: [] }, measured).status).toBe('failed');
    const dangling = { ...clean, doors: [{ ...clean.doors[0]!, wallId: 'no-such-wall' }] };
    expect(assessExtraction(dangling, measured).status).toBe('failed');
  });

  it('reports printed dimensions that disagree with the drawing', () => {
    const r = assessExtraction(clean, { ...measured, samplesRejected: 2 });
    expect(r.problems.find((p) => p.code === 'dimension-mismatch')?.message).toMatch(/2 printed dimensions/);
  });
});
