import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractFromImage } from '../../cv/extractor';
import { loadImageFile } from '../../cv/loadImage.node';
import { compareAnnotations, formatMetrics, type ExtractionMetrics } from '../../cv/metrics';
import { nodeOcrProvider } from '../../cv/ocrNode';
import { buildApartment, type ExtractionResult } from '../../extraction';
import { E2_ANNOTATIONS } from './annotations';

/**
 * End-to-end regression: the real E2 image → automatic extraction → the shared validation and
 * reconstruction pipeline, scored against the hand-made E2 annotations (ground truth, never
 * edited to suit the extractor). The bounds below are regression floors set from the measured
 * results — they are deliberately NOT the acceptance targets; the report prints the real numbers.
 */
const ocr = nodeOcrProvider();
let result: ExtractionResult;
let m: ExtractionMetrics;

beforeAll(async () => {
  const img = loadImageFile(resolve(__dirname, '../../../../floor-plans/E2-floorplan.jpg'));
  result = await extractFromImage(
    img,
    { id: 'e2', file: 'E2-floorplan.jpg', mimeType: 'image/jpeg' },
    { ocr },
  );
  m = compareAnnotations(E2_ANNOTATIONS, result.annotations);
  console.log(formatMetrics('E2 automatic extraction vs manual annotations', m));
  console.log(
    'review:',
    result.review?.status,
    result.review?.problems
      .map(
        (p) => `
  ${p.severity}: ${p.message}`,
      )
      .join(''),
  );
}, 120_000);

afterAll(() => ocr.dispose());

describe('E2 automatic extraction', () => {
  it('produces annotations that reconstruct into a valid apartment', () => {
    const { apartment, annotationIssues, modelIssues } = buildApartment(result.annotations);
    expect(annotationIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(modelIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(apartment.floors[0]!.rooms.length).toBeGreaterThanOrEqual(8);
    expect(apartment.floors[0]!.walls.length).toBeGreaterThan(10);
  });

  it('calibrates from the printed dimensions within 2 %', () => {
    expect(m.scale.strategy).toBe('dimension-labels');
    expect(m.scale.relativeError).toBeLessThan(0.02);
  });

  it('detects the structural walls, including the balcony railing', () => {
    expect(m.walls.detectionRate).toBeGreaterThanOrEqual(0.9);
    expect(m.walls.falsePositives).toBe(0);
    expect(m.walls.endpointErrorM.median).toBeLessThan(0.05);
    expect(result.annotations.walls.filter((w) => w.kind === 'railing')).toHaveLength(2);
  });

  it('segments the enclosed rooms precisely', () => {
    expect(m.rooms.matched).toBeGreaterThanOrEqual(9);
    expect(m.rooms.meanIoU).toBeGreaterThan(0.95);
    expect(result.annotations.rooms.find((r) => r.type === 'balcony')?.exterior).toBe(true);
  });

  it('finds doors and windows', () => {
    expect(m.windows.detectionRate).toBe(1);
    expect(m.windows.falsePositives).toBe(0);
    expect(m.doors.detectionRate).toBeGreaterThanOrEqual(0.85);
    expect(m.doors.falsePositives).toBe(0);
    expect(m.doors.positionErrorM.max).toBeLessThan(0.15);
    expect(m.doors.widthErrorM.median).toBeLessThan(0.05);
  });

  it('reads the room names and the reported area', () => {
    expect(m.rooms.labelsCorrect).toBeGreaterThanOrEqual(8);
    expect(result.annotations.reportedArea?.m2).toBeCloseTo(57.4, 1);
  });

  it('never claims more certainty than it has: what it could not resolve is flagged for review', () => {
    expect(result.review?.status).toBe('needs-review');
    const codes = new Set(result.review?.problems.map((p) => p.code));
    // The kitchen doorway has no door symbol; small unlabelled cupboards are inferred.
    expect(codes.has('unclassified-opening')).toBe(true);
    expect(codes.has('inferred-room')).toBe(true);
  });
});
