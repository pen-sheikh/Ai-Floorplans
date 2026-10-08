import { describe, expect, it } from 'vitest';
import { EvidenceRoomClassifier, type RoomEvidence } from './classify';
import { matchRoomName } from './text';

const classifier = new EvidenceRoomClassifier();
const base: RoomEvidence = {
  aspect: 1.3,
  doors: 1,
  windows: 1,
  openings: 0,
  railing: false,
  exteriorShare: 0,
  neighbours: 1,
  scaleMeasured: true,
};

describe('EvidenceRoomClassifier', () => {
  it('uses a readable label, with the OCR confidence and word strength', () => {
    const c = classifier.classify({ ...base, areaM2: 12, label: matchRoomName('BEDROOM', 0.9)! });
    expect(c).toMatchObject({ type: 'bedroom', source: 'label' });
    expect(c.confidence).toBeCloseTo(0.9, 6);
    expect(c.labelConfidence).toBe(0.9);
  });

  it('lowers confidence when the size contradicts the label', () => {
    const c = classifier.classify({ ...base, areaM2: 1.2, label: matchRoomName('BEDROOM', 0.9)! });
    expect(c.type).toBe('bedroom');
    expect(c.confidence).toBeLessThan(0.6);
    expect(c.evidence.join(' ')).toMatch(/unusual for a bedroom/);
  });

  it('keeps an ambiguous word as a suggestion only', () => {
    const c = classifier.classify({ ...base, areaM2: 12, label: matchRoomName('Zimmer 3', 0.6)! });
    expect(c.type).toBe('unknown');
    expect(c.suggestedType).toBe('bedroom');
  });

  it('keeps a real name without a model type (Study) as unknown type, label kept', () => {
    const c = classifier.classify({ ...base, areaM2: 9, label: matchRoomName('STUDY', 0.95)! });
    expect(c.type).toBe('unknown');
    expect(c.labelConfidence).toBe(0.95);
  });

  it('without a label, assigns a type only on strong evidence', () => {
    expect(classifier.classify({ ...base, areaM2: 0.9, windows: 0 }).type).toBe('storage');
    expect(classifier.classify({ ...base, areaM2: 9, aspect: 5, doors: 4, windows: 0 }).type).toBe('hall');
  });

  it('does not over-classify: weak evidence stays "unknown" with a suggestion', () => {
    const c = classifier.classify({ ...base, areaM2: 12 });
    expect(c.type).toBe('unknown');
    expect(c.confidence).toBe(0);
    expect(c.suggestedType).toBe('bedroom');
    const rail = classifier.classify({ ...base, areaM2: 4, railing: true });
    expect(rail.type).toBe('unknown'); // railing-like double lines are also windows
    expect(rail.suggestedType).toBe('balcony');
  });

  it('reports no evidence honestly', () => {
    const c = classifier.classify({ ...base });
    expect(c).toMatchObject({ type: 'unknown', source: 'none' });
  });

  it('uses symbol evidence when available (provider-agnostic input)', () => {
    expect(classifier.classify({ ...base, areaM2: 5, symbols: ['bath', 'basin'] }).type).toBe('bathroom');
    // Toilet + basin could be a WC or a bathroom: contested evidence decides nothing.
    expect(classifier.classify({ ...base, areaM2: 5, symbols: ['toilet', 'basin'] }).type).toBe('unknown');
  });
});
