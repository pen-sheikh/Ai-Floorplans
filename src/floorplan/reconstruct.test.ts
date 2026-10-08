import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonContainsPolygon, wallLength } from '../domain/geometry';
import { roomMetrics } from '../domain/topology';
import { validateApartment } from '../domain/validation';
import type { FloorPlanAnnotations } from './annotationTypes';
import { buildApartment, buildApartmentFromSource, StaticAnnotationExtractor } from './extraction';
import { SYNTHETIC_ANNOTATIONS as SYN } from './fixtures/synthetic/annotations';
import { reconstructApartment, ReconstructionError } from './reconstruct';
import { validateAnnotations } from './validateAnnotations';

/**
 * Generic pipeline tests on a synthetic, non-E2 plan: angled wall, irregular and L-shaped
 * rooms, concave fixture, dimension-line calibration, automatic-extractor provenance.
 */
describe('reconstruction pipeline (plan-agnostic)', () => {
  const { apartment, annotationIssues, modelIssues } = buildApartment(SYN);
  const floor = apartment.floors[0]!;
  const wall = (id: string) => floor.walls.find((w) => w.id === id)!;

  it('produces a valid model with no annotation errors', () => {
    expect(annotationIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(modelIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateApartment(apartment).ok).toBe(true);
  });

  it('calibrates from dimension lines (50 px/m)', () => {
    const cal = apartment.coordinateSystem.plan!.calibration;
    expect(cal.pixelsPerMeter).toBeCloseTo(50);
    expect(cal.samples.map((s) => s.referenceId)).toEqual(['dim-top', 'dim-left']);
  });

  it('builds angled walls with correct length and opening positions', () => {
    const angled = wall('angled');
    expect(wallLength(angled)).toBeCloseTo(Math.hypot(100, 100) / 50, 6);
    const win = floor.windows.find((w) => w.id === 'win-angled')!;
    // Span [430, 470] on the x axis of a 45° wall → 40/cos45 px wide.
    expect(win.width).toBeCloseTo(40 / Math.SQRT1_2 / 50, 6);
    expect(win.offset).toBeCloseTo((450 - 403.5) / Math.SQRT1_2 / 50, 6);
    expect(win.sillHeight).toBe(0.9);
  });

  it('keeps irregular and L-shaped rooms exactly', () => {
    const living = floor.rooms.find((r) => r.id === 'living')!;
    const bedroom = floor.rooms.find((r) => r.id === 'bedroom')!;
    expect(roomMetrics(living).area).toBeCloseTo(8 * 6 - 0.5 * 2 * 2, 6);
    expect(roomMetrics(bedroom).area).toBeCloseTo(4 * 1.8 + 2 * 1.2, 6);
    expect(pointInPolygon({ x: 7.8, z: 5.8 }, living.polygon)).toBe(false); // in the cut-off corner
  });

  it('connects rooms and resolves swing sides on any wall', () => {
    const door = floor.doors.find((d) => d.id === 'door-bed')!;
    expect([...door.connects].sort()).toEqual(['bedroom', 'living']);
    expect(door.connects[door.swingSide === 1 ? 1 : 0]).toBe('bedroom');
    const entry = floor.doors.find((d) => d.id === 'door-entry')!;
    expect(entry.connects[entry.swingSide === 1 ? 1 : 0]).toBe('living');
  });

  it('keeps concave fixture outlines', () => {
    const counter = floor.fixtures.find((f) => f.id === 'counter-l')!;
    expect(counter.footprint).toHaveLength(6);
    expect(counter.roomId).toBe('living');
    expect(
      polygonContainsPolygon(floor.rooms.find((r) => r.id === 'living')!.polygon, counter.footprint, 0.01),
    ).toBe(true);
  });

  it('records provenance and confidence without changing geometry', () => {
    expect(wall('angled')).toMatchObject({
      sources: { geometry: 'detected', height: 'assumed' },
      confidence: 0.7,
    });
    expect(floor.windows.find((w) => w.id === 'win-top')!.sources).toEqual({
      geometry: 'detected',
      sillHeight: 'assumed',
      height: 'assumed',
    });
    expect(apartment.metadata.annotationSource).toEqual({
      method: 'automatic',
      producer: 'synthetic-test-extractor',
      confidence: 0.8,
    });
    // The same annotations marked as manual give identical geometry, only different provenance.
    const manual = buildApartment({ ...SYN, source: { method: 'manual' } }).apartment.floors[0]!;
    expect(manual.walls.map((w) => [w.start, w.end, w.thickness])).toEqual(
      floor.walls.map((w) => [w.start, w.end, w.thickness]),
    );
    expect(manual.walls[0]!.sources.geometry).toBe('plan-geometry');
  });

  it('runs through the extractor boundary unchanged', async () => {
    const extractor = new StaticAnnotationExtractor({ [SYN.id]: SYN });
    const res = await buildApartmentFromSource(
      { id: SYN.id, file: SYN.image.file, mimeType: 'image/png' },
      extractor,
    );
    expect(res.apartment).toEqual(apartment);
    expect(res.extraction.stages[0]!.status).toBe('ok');
  });
});

describe('annotation validation (extractor output is untrusted)', () => {
  const codes = (ann: FloorPlanAnnotations) =>
    validateAnnotations(ann)
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);
  const withDoor = (patch: Partial<FloorPlanAnnotations['doors'][number]>) => ({
    ...SYN,
    doors: [{ ...SYN.doors[0]!, ...patch }, ...SYN.doors.slice(1)],
  });

  it('accepts the synthetic plan', () => {
    expect(codes(SYN)).toEqual([]);
  });

  it('reports dangling references, bad spans and overlapping openings', () => {
    expect(codes(withDoor({ wallId: 'ghost' }))).toContain('opening-wall');
    expect(codes(withDoor({ span: [600, 700] }))).toContain('opening-outside-wall');
    expect(
      codes({
        ...SYN,
        windows: [...SYN.windows, { id: 'w2', wallId: 'top', span: [300, 400], kind: 'standard' }],
      }),
    ).toContain('opening-overlap');
    expect(codes(withDoor({ swing: 'up' }))).toContain('door-swing'); // along a vertical wall
  });

  it('reports broken polygons, duplicate ids and bad confidences', () => {
    const bow = {
      ...SYN.rooms[0]!,
      polygon: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
    };
    expect(codes({ ...SYN, rooms: [bow, SYN.rooms[1]!] })).toContain('room-self-intersection');
    expect(codes({ ...SYN, rooms: [SYN.rooms[0]!, { ...SYN.rooms[1]!, id: 'living' }] })).toContain(
      'duplicate-id',
    );
    expect(
      codes({ ...SYN, walls: [{ ...SYN.walls[0]!, confidence: 1.4 }, ...SYN.walls.slice(1)] }),
    ).toContain('confidence-range');
  });

  it('refuses to invent a scale', () => {
    expect(codes({ ...SYN, calibration: {} })).toContain('no-scale');
    const r = reconstructApartment({ ...SYN, calibration: {} }, { pixelsPerMeter: 50 });
    expect(r.coordinateSystem.plan!.calibration).toMatchObject({ method: 'manual', confidence: 'low' });
  });

  it('reconstruction fails with every annotation error listed', () => {
    const bad = { ...withDoor({ wallId: 'ghost' }), calibration: {} };
    try {
      reconstructApartment(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReconstructionError);
      expect((e as ReconstructionError).issues.map((i) => i.code).sort()).toEqual([
        'no-scale',
        'opening-wall',
      ]);
    }
  });
});

describe('provenance of automatically extracted rooms', () => {
  const auto: FloorPlanAnnotations = {
    ...SYN,
    source: { method: 'automatic', producer: 'test' },
    rooms: SYN.rooms.map((r, i) =>
      i === 0
        ? { ...r, name: 'Room 1', type: 'unknown', labelSource: 'unknown', geometryConfidence: 0.9 }
        : { ...r, labelSource: 'plan-label', labelConfidence: 0.8, classificationConfidence: 0.7 },
    ),
  };
  const { apartment } = buildApartment(auto);
  const [unknown, read] = apartment.floors[0]!.rooms;

  it('keeps an unlabelled room as "Unknown Room" with its floor, never a guessed type', () => {
    expect(unknown).toMatchObject({ name: 'Unknown Room', type: 'unknown', labelSource: 'inferred' });
    expect(unknown!.sources.name).toBeUndefined();
    expect(unknown!.sources.type).toBeUndefined();
    expect(unknown!.polygon.length).toBeGreaterThanOrEqual(3);
    expect(unknown!.geometryConfidence).toBe(0.9);
  });

  it('marks names read by OCR as "ocr", not as printed fact', () => {
    expect(read!.labelSource).toBe('ocr');
    expect(read!.sources).toMatchObject({ name: 'ocr', type: 'ocr' });
    expect(read).toMatchObject({ labelConfidence: 0.8, classificationConfidence: 0.7 });
  });
});
