import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FloorPlanAnnotations } from '../annotationTypes';
import { extractFromImage } from '../cv/extractor';
import { loadImageFile } from '../cv/loadImage.node';
import { compareAnnotations, formatMetrics, type ExtractionMetrics } from '../cv/metrics';
import { nodeOcrProvider } from '../cv/ocrNode';
import { buildApartment, type ExtractionResult } from '../extraction';
import { validateAnnotations } from '../validateAnnotations';
import { SYNTHETIC_ANNOTATIONS } from './synthetic/annotations';
import { SYNTHETIC_CORRIDOR_ANNOTATIONS } from './synthetic-corridor/annotations';
import { SYNTHETIC_MM_ANNOTATIONS } from './synthetic-mm/annotations';

/**
 * Three structurally different plans rendered from known annotations (scripts/render-test-plans.ts):
 *  - synthetic-angled: 45° wall with a window in it, L-shaped bedroom, scale from dimension lines;
 *  - synthetic-mm: grey outlined walls, door jamb boxes, L-shaped living room, sizes in mm;
 *  - synthetic-corridor: 40 px/m, corridor with T-junctions, double door, railed balcony,
 *    serif title-case labels, duplicate room names, overall dimension lines only.
 * The extractor knows none of this. Bounds are regression floors below the measured results.
 */
const PLANS: FloorPlanAnnotations[] = [
  SYNTHETIC_ANNOTATIONS,
  SYNTHETIC_MM_ANNOTATIONS,
  SYNTHETIC_CORRIDOR_ANNOTATIONS,
];
const ocr = nodeOcrProvider();
const results = new Map<string, { result: ExtractionResult; metrics: ExtractionMetrics }>();

beforeAll(async () => {
  for (const truth of PLANS) {
    const img = loadImageFile(resolve(__dirname, '../../../floor-plans/test', truth.image.file));
    const result = await extractFromImage(
      img,
      { id: truth.id, file: truth.image.file, mimeType: 'image/png' },
      { ocr },
    );
    const metrics = compareAnnotations(truth, result.annotations);
    console.log(formatMetrics(truth.id, metrics));
    results.set(truth.id, { result, metrics });
  }
}, 180_000);

afterAll(() => ocr.dispose());

describe.each(PLANS.map((p) => [p.id, p] as const))('%s', (id, truth) => {
  const get = () => results.get(id)!;

  it('ground truth itself is valid', () => {
    expect(validateAnnotations(truth).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('extracts annotations that reconstruct into a valid apartment', () => {
    const { result } = get();
    expect(result.review?.status).not.toBe('failed');
    const { annotationIssues, modelIssues, apartment } = buildApartment(result.annotations);
    expect(annotationIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(modelIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(apartment.floors[0]!.rooms.length).toBe(truth.rooms.length);
  });

  it('recovers walls, rooms and openings', () => {
    const { metrics: m } = get();
    expect(m.walls.detectionRate).toBe(1);
    expect(m.walls.falsePositives).toBe(0);
    expect(m.walls.endpointErrorM.max).toBeLessThan(0.12);
    expect(m.rooms.matched).toBe(m.rooms.expected);
    expect(m.rooms.minIoU).toBeGreaterThan(0.95);
    expect(m.doors.detectionRate).toBe(1);
    expect(m.doors.falsePositives).toBe(0);
    expect(m.doors.widthErrorM.max).toBeLessThan(0.08);
    expect(m.windows.detectionRate).toBe(1);
    expect(m.windows.falsePositives).toBe(0);
    expect(m.windows.widthErrorM.max).toBeLessThan(0.1);
  });

  it('calibrates from printed dimensions within 2 %', () => {
    const { metrics: m } = get();
    expect(m.scale.strategy).toBe('dimension-labels');
    expect(m.scale.relativeError).toBeLessThan(0.02);
  });

  it('reads the room names', () => {
    const { metrics: m } = get();
    const printed = truth.rooms.filter((r) => r.labelSource === 'plan-label').length;
    expect(m.rooms.labelsCorrect).toBeGreaterThanOrEqual(printed);
  });
});
