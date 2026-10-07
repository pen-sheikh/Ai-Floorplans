import { describe, expect, it } from 'vitest';
import { blankImage, paintLine, rasterPlan } from '../../test/rasterPlan';
import { FakeOcr } from '../../test/fakeOcr';
import { buildApartment } from '../extraction';
import {
  SYNTHETIC_CORRIDOR_ANNOTATIONS,
  SYNTHETIC_CORRIDOR_STYLE,
} from '../fixtures/synthetic-corridor/annotations';
import { SYNTHETIC_MM_ANNOTATIONS, SYNTHETIC_MM_STYLE } from '../fixtures/synthetic-mm/annotations';
import { ComputerVisionExtractor, extractFromImage } from './extractor';
import { compareAnnotations } from './metrics';

const source = (id: string) => ({ id, file: `${id}.png`, mimeType: 'image/png' as const });

describe('extractFromImage (rasterised plans, fake OCR)', () => {
  const mmImage = rasterPlan(SYNTHETIC_MM_ANNOTATIONS, SYNTHETIC_MM_STYLE);

  it('recovers a plan drawn from known annotations', async () => {
    const r = await extractFromImage(mmImage, source('mm'), {
      ocr: FakeOcr.forPlan(SYNTHETIC_MM_ANNOTATIONS, SYNTHETIC_MM_STYLE),
    });
    const m = compareAnnotations(SYNTHETIC_MM_ANNOTATIONS, r.annotations);
    expect(m.walls.detectionRate).toBe(1);
    expect(m.rooms.matched).toBe(5);
    expect(m.rooms.labelsCorrect).toBe(5);
    expect(m.doors.detectionRate).toBe(1);
    expect(m.windows.detectionRate).toBe(1);
    expect(m.scale.relativeError).toBeLessThan(0.02);
    expect(buildApartment(r.annotations).modelIssues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('reports progress for every stage, in order', async () => {
    const seen: string[] = [];
    const r = await extractFromImage(mmImage, source('mm'), { onProgress: (stage) => seen.push(stage) });
    expect(seen).toEqual(['preprocess', 'walls', 'openings', 'rooms', 'calibration', 'annotations']);
    expect(r.stages.find((s) => s.stage === 'text')?.status).toBe('skipped');
    expect(r.stages.every((s) => s.status === 'skipped' || typeof s.ms === 'number')).toBe(true);
  });

  it('is usable through the FloorPlanExtractor interface', async () => {
    const extractor = new ComputerVisionExtractor(async () => mmImage);
    const r = await extractor.extract(source('mm'));
    expect(r.annotations.source.method).toBe('automatic');
    expect(r.annotations.rooms.length).toBe(5);
  });
});

describe('calibration strategy priority', () => {
  const img = rasterPlan(SYNTHETIC_CORRIDOR_ANNOTATIONS, SYNTHETIC_CORRIDOR_STYLE);
  const truthPpm = 40;

  it('1. an explicit reference measurement wins over printed dimensions', async () => {
    const r = await extractFromImage(img, source('c'), {
      ocr: FakeOcr.forPlan(SYNTHETIC_CORRIDOR_ANNOTATIONS, SYNTHETIC_CORRIDOR_STYLE),
      // 4 m between two points 160 px apart = 40 px/m.
      reference: { a: { x: 100, y: 50 }, b: { x: 260, y: 50 }, meters: 4 },
    });
    expect(r.calibration?.strategy).toBe('reference');
    expect(r.calibration?.pixelsPerMeter).toBeCloseTo(truthPpm, 6);
  });

  it('2. printed dimensions are measured on their dimension lines', async () => {
    const r = await extractFromImage(img, source('c'), {
      ocr: FakeOcr.forPlan(SYNTHETIC_CORRIDOR_ANNOTATIONS, SYNTHETIC_CORRIDOR_STYLE),
    });
    expect(r.calibration?.strategy).toBe('dimension-labels');
    expect(Math.abs(r.calibration!.pixelsPerMeter / truthPpm - 1)).toBeLessThan(0.02);
    // One printed value cannot be cross-checked: that is reported, not hidden.
    expect(r.review?.problems.some((p) => p.code === 'annotation-single-scale-reference')).toBe(true);
  });

  it('3. a user-entered scale is used when the plan has no readable dimensions', async () => {
    const r = await extractFromImage(img, source('c'), { pixelsPerMeter: 41 });
    expect(r.calibration?.strategy).toBe('manual');
    expect(r.calibration?.pixelsPerMeter).toBe(41);
    expect(r.calibration?.confidence).toBe('low');
  });

  it('4. otherwise the scale is ESTIMATED from typical door widths, and says so', async () => {
    const r = await extractFromImage(img, source('c'), {});
    expect(r.calibration?.strategy).toBe('estimated');
    expect(r.calibration?.confidence).toBe('low');
    expect(r.calibration?.basis).toMatch(/door widths/);
    expect(r.annotations.calibration?.estimatedPixelsPerMeter?.basis).toMatch(/door widths/);
    expect(r.review?.status).toBe('needs-review');
    expect(r.review?.problems.some((p) => p.code === 'scale-estimated')).toBe(true);
    // Still a usable estimate (doors are drawn 0.7–0.9 m wide), never presented as measured.
    expect(Math.abs(r.calibration!.pixelsPerMeter / truthPpm - 1)).toBeLessThan(0.2);
  });
});

describe('confidence and failure', () => {
  it('propagates per-entity confidence into category and overall scores', async () => {
    const r = await extractFromImage(rasterPlan(SYNTHETIC_MM_ANNOTATIONS, SYNTHETIC_MM_STYLE), source('mm'), {
      ocr: FakeOcr.forPlan(SYNTHETIC_MM_ANNOTATIONS, SYNTHETIC_MM_STYLE),
    });
    const c = r.confidence!;
    for (const k of ['walls', 'doors', 'windows', 'rooms', 'calibration', 'overall'] as const) {
      expect(c[k]).toBeGreaterThan(0);
      expect(c[k]).toBeLessThanOrEqual(1);
    }
    expect(r.annotations.source.confidence).toBe(c.overall);
    // The symbol-less kitchen doorway is kept, but with low confidence and a review item.
    const doorway = r.annotations.doors.find((d) => d.kind === 'opening');
    expect(doorway?.confidence).toBeLessThan(0.6);
    expect(
      r.review?.problems.some((p) => p.code === 'unclassified-opening' && p.elementId === doorway?.id),
    ).toBe(true);
  });

  it('fails (and builds nothing) on an image with no plan in it', async () => {
    const r = await extractFromImage(blankImage(400, 300), source('blank'), {});
    expect(r.review?.status).toBe('failed');
    expect(r.review?.problems.some((p) => p.code === 'no-rooms')).toBe(true);
  });

  it('fails on a drawing that is not a closed plan (a few loose strokes)', async () => {
    const img = blankImage(400, 300);
    paintLine(img, { x: 50, y: 50 }, { x: 350, y: 50 }, 10, 0);
    paintLine(img, { x: 50, y: 50 }, { x: 50, y: 250 }, 10, 0);
    const r = await extractFromImage(img, source('strokes'), {});
    expect(r.annotations.rooms).toHaveLength(0);
    expect(r.review?.status).toBe('failed');
  });

  it('survives an OCR failure: geometry is kept, the failure is reported', async () => {
    const broken = { name: 'broken', recognize: async () => Promise.reject(new Error('worker crashed')) };
    const r = await extractFromImage(rasterPlan(SYNTHETIC_MM_ANNOTATIONS, SYNTHETIC_MM_STYLE), source('mm'), {
      ocr: broken,
    });
    expect(r.annotations.rooms.length).toBe(5);
    expect(r.stages.find((s) => s.stage === 'text')?.status).toBe('failed');
    expect(r.warnings.join(' ')).toMatch(/OCR failed/);
    expect(r.review?.problems.some((p) => p.code === 'unnamed-room')).toBe(true);
  });
});
