import { describe, expect, it } from 'vitest';
import { rasterPlan } from '../test/rasterPlan';
import { FakeOcr } from '../test/fakeOcr';
import { parseAnnotationsJson, VISION_EXTRACTION_INSTRUCTIONS } from './annotationSchema';
import { E2_ANNOTATIONS } from './fixtures/e2/annotations';
import { SYNTHETIC_MM_ANNOTATIONS, SYNTHETIC_MM_STYLE } from './fixtures/synthetic-mm/annotations';
import {
  ExtractionServiceError,
  LocalExtractionService,
  RemoteExtractionService,
  resultFromRemoteJson,
} from './extractionService';

const source = {
  id: 'e2',
  file: 'E2-floorplan.jpg',
  mimeType: 'image/jpeg' as const,
  widthPx: E2_ANNOTATIONS.image.widthPx,
  heightPx: E2_ANNOTATIONS.image.heightPx,
};

describe('parseAnnotationsJson', () => {
  it('accepts every reference fixture, including via a JSON string', () => {
    expect(parseAnnotationsJson(E2_ANNOTATIONS).ok).toBe(true);
    expect(parseAnnotationsJson(JSON.stringify(SYNTHETIC_MM_ANNOTATIONS)).ok).toBe(true);
  });

  it('rejects (never repairs) malformed output', () => {
    const bad = (patch: object) => parseAnnotationsJson({ ...E2_ANNOTATIONS, ...patch });
    expect(bad({ formatVersion: 2 }).ok).toBe(false);
    expect(
      bad({
        walls: [
          { id: 'w', kind: 'concrete', segment: { a: { x: 0, y: 0 }, b: { x: 9, y: 0 }, thicknessPx: 5 } },
        ],
      }).ok,
    ).toBe(false);
    expect(
      bad({ rooms: [{ id: 'r', name: 'x', type: 'ballroom', labelSource: 'plan-label', polygon: [] }] }).ok,
    ).toBe(false);
    expect(bad({ doors: [{ ...E2_ANNOTATIONS.doors[0]!, span: [Number.NaN, 3] }] }).ok).toBe(false);
    expect(bad({ threeJsScene: '<mesh/>' }).ok).toBe(false); // nothing beyond the schema
    expect(parseAnnotationsJson('not json').ok).toBe(false);
    const r = bad({ windows: [{ ...E2_ANNOTATIONS.windows[0]!, confidence: 7 }] });
    expect(r.ok ? [] : r.errors).toEqual([expect.stringMatching(/windows\[0\]\.confidence/)]);
  });

  it('documents the contract for server-side vision models', () => {
    expect(VISION_EXTRACTION_INSTRUCTIONS).toMatch(/kitchen-living/);
    expect(VISION_EXTRACTION_INSTRUCTIONS).toMatch(/Never invent a scale/);
  });
});

describe('resultFromRemoteJson', () => {
  it('recomputes calibration, confidence and review instead of trusting the server', () => {
    const r = resultFromRemoteJson({ annotations: E2_ANNOTATIONS, review: { status: 'ok' } }, source);
    expect(r.annotations.source.method).toBe('automatic');
    expect(r.calibration?.strategy).toBe('dimension-labels');
    expect(r.review).toBeDefined();
    expect(r.confidence?.overall).toBeGreaterThan(0);
  });

  it('rejects schema violations and mismatched images with details', () => {
    expect(() => resultFromRemoteJson({ annotations: { ...E2_ANNOTATIONS, walls: 'none' } }, source)).toThrow(
      ExtractionServiceError,
    );
    expect(() => resultFromRemoteJson({}, source)).toThrow(/no annotations/);
    expect(() => resultFromRemoteJson({ annotations: E2_ANNOTATIONS }, { ...source, widthPx: 10 })).toThrow(
      /different size/,
    );
  });
});

describe('RemoteExtractionService', () => {
  it('posts the file to its own endpoint without any credentials of its own', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ annotations: E2_ANNOTATIONS }), { status: 200 });
    }) as unknown as typeof fetch;
    const svc = new RemoteExtractionService('/api/extract-floorplan', fetchImpl);
    const r = await svc.extract({
      image: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
      source,
      file: new Blob(['x']),
    });
    expect(calls[0]!.url).toBe('/api/extract-floorplan');
    expect(new Headers(calls[0]!.init.headers).has('authorization')).toBe(false);
    expect(r.annotations.walls.length).toBe(E2_ANNOTATIONS.walls.length);
  });

  it('surfaces HTTP failures', async () => {
    const svc = new RemoteExtractionService(
      '/x',
      (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch,
    );
    await expect(
      svc.extract({
        image: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
        source,
        file: new Blob(['x']),
      }),
    ).rejects.toThrow(/HTTP 502/);
  });
});

describe('LocalExtractionService', () => {
  it('runs the on-device extractor with user corrections', async () => {
    const svc = new LocalExtractionService(() =>
      FakeOcr.forPlan(SYNTHETIC_MM_ANNOTATIONS, SYNTHETIC_MM_STYLE),
    );
    const stages: string[] = [];
    const r = await svc.extract(
      {
        image: rasterPlan(SYNTHETIC_MM_ANNOTATIONS, SYNTHETIC_MM_STYLE),
        source: { id: 'mm', file: 'mm.png', mimeType: 'image/png' },
        reference: { a: { x: 100, y: 50 }, b: { x: 700, y: 50 }, meters: 10 },
      },
      (s) => stages.push(s),
    );
    expect(svc.local).toBe(true);
    expect(r.calibration?.strategy).toBe('reference');
    expect(r.calibration?.pixelsPerMeter).toBeCloseTo(60, 6);
    expect(stages).toContain('text');
  });
});
