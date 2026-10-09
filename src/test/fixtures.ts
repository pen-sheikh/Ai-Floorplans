import { buildApartment } from '../floorplan';
import { E2_ANNOTATIONS } from '../floorplan/fixtures/e2/annotations';
import { SYNTHETIC_ANNOTATIONS } from '../floorplan/fixtures/synthetic/annotations';
import type { Apartment, Floor, Room } from '../domain/types';

/** The real E2 plan, built through the same generic pipeline the app uses. */
export const e2 = (): Apartment => buildApartment(E2_ANNOTATIONS).apartment;

/**
 * The synthetic plan as if it had been extracted automatically: OCR-read names (`ocr` name/type
 * provenance) and the extractor's confidences, as an uploaded plan would have.
 */
export const automaticSynthetic = (): Apartment =>
  buildApartment({
    ...SYNTHETIC_ANNOTATIONS,
    source: { method: 'automatic', producer: 'test' },
    rooms: SYNTHETIC_ANNOTATIONS.rooms.map((r) => ({
      ...r,
      labelSource: 'plan-label' as const,
      geometryConfidence: 0.9,
      labelConfidence: 0.8,
      classificationConfidence: 0.7,
      classification: { evidence: ['label "x"'] },
    })),
  }).apartment;
export const e2Floor = (): Floor => e2().floors[0]!;

export const room = (floor: Floor, id: string): Room => {
  const r = floor.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`room ${id} missing`);
  return r;
};

let n = 0;
export const testId = (): string => `test-${++n}`;
