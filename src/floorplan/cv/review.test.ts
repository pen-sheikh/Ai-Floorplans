import { describe, expect, it } from 'vitest';
import { SYNTHETIC_MM_ANNOTATIONS } from '../fixtures/synthetic-mm/annotations';
import { EXTRACTION_ISSUE_CATEGORIES, type ExtractionCalibrationReport } from '../extraction';
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

  it('accepts valid geometry with unknown rooms as ok-with-warnings, not a failure', () => {
    const ann = {
      ...clean,
      rooms: clean.rooms.map((r, i) =>
        i === 0
          ? { ...r, name: 'Unknown Room', type: 'unknown' as const, labelSource: 'unknown' as const }
          : r,
      ),
    };
    const r = assessExtraction(ann, measured);
    expect(r.status).toBe('ok-with-warnings');
    const unnamed = r.problems.find((p) => p.code === 'unnamed-room');
    expect(unnamed).toMatchObject({ category: 'room_label', impact: 'semantic-uncertainty' });
    expect(unnamed?.message).toMatch(/valid geometry but no readable label/);
    expect(r.components.walls.status).toBe('good');
    expect(r.components.rooms.status).toBe('good');
    expect(r.components.roomLabels.status).toBe('uncertain');
  });

  it('fails walls and rooms when the whole drawing is unsupported', () => {
    const r = assessExtraction(clean, measured, {
      stageProblems: [
        {
          severity: 'error',
          code: 'thin-line-drawing',
          category: 'structural_ambiguity',
          impact: 'geometry-failure',
          message: 'thin lines',
        },
      ],
    });
    expect(r.status).toBe('failed');
    expect(r.components.walls.status).toBe('failed');
    expect(r.components.rooms.status).toBe('failed');
  });

  it('puts every problem in the taxonomy with an impact', () => {
    const r = assessExtraction({ ...clean, rooms: [] }, { ...measured, strategy: 'estimated', basis: 'x' });
    for (const p of r.problems) {
      expect(EXTRACTION_ISSUE_CATEGORIES).toContain(p.category);
      expect([
        'geometry-failure',
        'geometry-uncertain',
        'semantic-uncertainty',
        'missing-optional',
      ]).toContain(p.impact);
    }
  });
});
