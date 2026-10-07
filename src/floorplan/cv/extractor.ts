import { pointInPolygon, polygonArea } from '../../domain/geometry';
import type { RoomType, ScaleCalibration } from '../../domain/types';
import type {
  AnnotatedDimension,
  AnnotatedDoor,
  AnnotatedLabel,
  AnnotatedRoom,
  AnnotatedWall,
  AnnotatedWindow,
  FloorPlanAnnotations,
  PxDirection,
  PxPoint,
} from '../annotationTypes';
import { calibrateAnnotations, CalibrationError } from '../calibrate';
import type {
  ExtractionCalibrationReport,
  ExtractionConfidence,
  ExtractionResult,
  ExtractionStageName,
  ExtractionStageReport,
  FloorPlanExtractor,
  FloorPlanSource,
} from '../extraction';
import { pxWallGeometry } from '../wallGeometry';
import { assessExtraction } from './review';
import { detectOpenings, type DetectedOpening } from './openings';
import { preprocessImage, wallThicknessProfile } from './preprocess';
import type { RgbaImage } from './raster';
import { segmentRooms, traceRegion, wallPolygon } from './rooms';
import { measureDimensionLines } from './dimensionLines';
import { detectHollowBands } from './railings';
import { proposeTextLines, textOnlyImage } from './textRegions';
import { readPlanText, type OcrProvider, type PlanText } from './text';
import { detectWalls, segDir, segNormal, type DetectedWall } from './walls';
import { fillConvexPolygon, newMask } from './raster';

/** Heights a plan does not show. Recorded as assumptions in every extracted model. */
export const DEFAULT_ASSUMED_HEIGHTS: FloorPlanAnnotations['defaults'] = {
  ceilingHeightMeters: 2.4,
  doorHeightMeters: 2.0,
  railingHeightMeters: 1.1,
  windowSillMeters: 0.9,
  windowHeadMeters: 2.1,
};

export interface CvExtractionOptions {
  /** OCR for room names and printed dimensions. Null/undefined: geometry only. */
  ocr?: OcrProvider | null;
  /** Strategy 1: a known measurement between two image points. */
  reference?: { a: PxPoint; b: PxPoint; meters: number };
  /** Strategy 3: a scale entered by the user (px per metre). */
  pixelsPerMeter?: number;
  /** Strategy 4 assumptions (only used when nothing better exists). */
  typicalDoorWidthMeters?: number;
  typicalExternalWallMeters?: number;
  defaults?: Partial<FloorPlanAnnotations['defaults']>;
  onProgress?: (stage: ExtractionStageName, message: string) => void;
}

const STAGE_LABEL: Record<ExtractionStageName, string> = {
  preprocess: 'Preprocessing…',
  walls: 'Detecting walls…',
  openings: 'Detecting openings…',
  rooms: 'Finding rooms…',
  text: 'Reading labels…',
  dimensions: 'Reading dimensions…',
  calibration: 'Calibrating…',
  annotations: 'Building annotations…',
};

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Local computer-vision extractor: image → FloorPlanAnnotations. Answers only "what does the
 * image contain?"; reconstruction (calibrated geometry, topology, validation) is done by the
 * shared pipeline exactly as for hand-made annotations. Nothing in here knows any specific plan.
 */
export class ComputerVisionExtractor implements FloorPlanExtractor {
  readonly name = 'computer-vision';
  constructor(
    private readonly decode: (source: FloorPlanSource) => Promise<RgbaImage>,
    private readonly options: CvExtractionOptions = {},
  ) {}

  async extract(source: FloorPlanSource): Promise<ExtractionResult> {
    return extractFromImage(await this.decode(source), source, this.options);
  }
}

export async function extractFromImage(
  img: RgbaImage,
  source: FloorPlanSource,
  opts: CvExtractionOptions = {},
): Promise<ExtractionResult> {
  const stages: ExtractionStageReport[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const run = async <T>(
    stage: ExtractionStageName,
    fn: () => T | Promise<T>,
    summarise: (r: T) => Omit<ExtractionStageReport, 'stage' | 'ms'>,
  ): Promise<T> => {
    opts.onProgress?.(stage, STAGE_LABEL[stage]);
    await yieldToUi();
    const t0 = performance.now();
    const r = await fn();
    stages.push({ stage, ms: Math.round(performance.now() - t0), ...summarise(r) });
    return r;
  };

  const pre = await run(
    'preprocess',
    () => preprocessImage(img),
    (p) => ({ status: 'ok', message: `ink threshold ${p.inkThreshold}` }),
  );
  const profile = wallThicknessProfile(pre);
  const walls0 = await run(
    'walls',
    () => detectWalls(pre, profile),
    (d) => ({
      status: d.walls.length ? 'ok' : 'failed',
      message: `${d.walls.length} wall segments; thickness classes ${profile.modes.join(', ')} px`,
    }),
  );
  const lineThreshold = Math.max(pre.inkThreshold + 60, 215);
  const ops = await run(
    'openings',
    () => detectOpenings({ gray: pre.gray, wallMask: walls0.wallMask, profile, lineThreshold }, walls0.walls),
    (o) => ({
      status: 'ok',
      message: `${o.openings.filter((x) => x.kind === 'door').length} doors, ${o.openings.filter((x) => x.kind === 'window').length} windows, ${o.openings.filter((x) => x.kind === 'opening').length} uncertain openings`,
    }),
  );
  const { seg, rails } = await run(
    'rooms',
    () => {
      const rails = detectHollowBands(
        { gray: pre.gray, wallMask: walls0.wallMask, lineThreshold, profile },
        ops.walls,
      );
      return {
        rails,
        seg: segmentRooms([...ops.walls, ...rails], img.width, img.height, profile.major, walls0.wallMask),
      };
    },
    ({ seg: s, rails: r }) => ({
      status: s.rooms.length ? 'ok' : 'failed',
      message: `${s.rooms.length} enclosed rooms${r.length ? `; ${r.length} railings` : ''}`,
    }),
  );

  let text: PlanText | null = null;
  if (opts.ocr) {
    try {
      text = await run(
        'text',
        () => {
          const proposals = proposeTextLines(pre.ink, walls0.wallMask);
          return readPlanText(img, opts.ocr!, {
            regions: proposals.lines,
            regionImage: textOnlyImage(img, proposals.glyphs),
          });
        },
        (t) => ({
          status: 'ok',
          message: `${t.names.length} room labels, ${t.dimensions.length} dimensions`,
        }),
      );
    } catch (e) {
      warnings.push(
        `OCR failed (${e instanceof Error ? e.message : String(e)}); rooms are unnamed and scale cannot be read from the plan.`,
      );
      stages.push({ stage: 'text', status: 'failed', message: 'OCR unavailable' });
    }
  } else {
    stages.push({ stage: 'text', status: 'skipped', message: 'No OCR provider configured' });
  }

  // ── Walls → annotation walls (exterior if one side is outside space) ──────────────
  // Outside = open space around the plan, plus exterior rooms (balconies) once named below.
  const outsideRegions = new Set<number>([-1]);
  const sideRegion = (w: DetectedWall, side: 1 | -1) => {
    const d = segDir(w);
    const n = segNormal(w);
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    let outside = 0;
    let samples = 0;
    for (let t = 0.15 * L; t <= 0.85 * L; t += Math.max(4, L / 12)) {
      const x = Math.floor(w.a.x + d.x * t + n.x * side * (w.thickness / 2 + 3));
      const y = Math.floor(w.a.y + d.y * t + n.y * side * (w.thickness / 2 + 3));
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      samples++;
      if (outsideRegions.has(seg.regionOf[y * img.width + x]!)) outside++;
    }
    return samples ? outside / samples : 0;
  };
  // Kinds are assigned once exterior rooms are known (below).
  const exterior = new Set<string>();
  const annWalls: AnnotatedWall[] = [...ops.walls, ...rails].map((w) => ({
    id: w.id,
    kind: rails.includes(w) ? 'railing' : 'interior',
    confidence: w.confidence,
    segment: { a: round2(w.a), b: round2(w.b), thicknessPx: +w.thickness.toFixed(2) },
  }));

  // ── Openings → doors/windows on the annotation walls' dominant axis ───────────────
  const wallById = new Map(ops.walls.map((w) => [w.id, w]));
  const annWallById = new Map(annWalls.map((w) => [w.id, w]));
  const doors: AnnotatedDoor[] = [];
  const windows: AnnotatedWindow[] = [];
  for (const o of ops.openings) {
    const w = wallById.get(o.wallId)!;
    const g = pxWallGeometry(annWallById.get(o.wallId)!);
    const at = (t: number) => ({ x: w.a.x + segDir(w).x * t, y: w.a.y + segDir(w).y * t });
    const dom = (p: PxPoint) => (g.dominant === 'x' ? p.x : p.y);
    const pFrom = at(o.from);
    const pTo = at(o.to);
    const span = [dom(pFrom), dom(pTo)].sort((x, y) => x - y).map((v) => +v.toFixed(2)) as [number, number];
    if (o.kind === 'window') {
      windows.push({ id: o.id, wallId: o.wallId, span, kind: 'standard', confidence: o.confidence });
      continue;
    }
    doors.push({
      id: o.id,
      wallId: o.wallId,
      span,
      kind: o.kind === 'opening' ? 'opening' : (o.doorKind ?? 'hinged'),
      hinge: hingeMinMax(o, pFrom, pTo, dom),
      swing: swingDirection(w, o),
      confidence: o.confidence,
      ...(o.kind === 'opening'
        ? { note: 'Gap between walls with no door symbol: may be an open doorway or a missing door.' }
        : {}),
    });
  }

  // ── Rooms, labels and printed dimensions ──────────────────────────────────────────
  const roomPolys = seg.rooms.map((r) => r.polygon.map((p) => ({ x: p.x, z: p.y })));
  const inRoom = (box: { x0: number; y0: number; x1: number; y1: number }) => {
    const c = { x: (box.x0 + box.x1) / 2, z: (box.y0 + box.y1) / 2 };
    return roomPolys.findIndex((poly) => pointInPolygon(c, poly));
  };
  const labels: AnnotatedLabel[] = [];
  const nameFor = new Map<number, PlanText['names'][number]>();
  const dimFor = new Map<number, PlanText['dimensions'][number]>();
  const unplacedLabels: string[] = [];
  text?.names.forEach((n, i) => {
    const id = `lbl${i + 1}`;
    labels.push({
      id,
      text: n.match.raw,
      at: { x: (n.box.x0 + n.box.x1) / 2, y: (n.box.y0 + n.box.y1) / 2 },
      role: 'room-name',
      confidence: n.match.confidence,
    });
    const k = inRoom(n.box);
    if (k < 0) {
      unplacedLabels.push(n.match.raw);
      return;
    }
    const prev = nameFor.get(k);
    if (!prev || n.box.y1 - n.box.y0 > prev.box.y1 - prev.box.y0) nameFor.set(k, n);
  });
  text?.dimensions.forEach((d) => {
    const k = inRoom(d.box);
    if (k >= 0 && d.parsed.values.length === 2 && !dimFor.has(k)) dimFor.set(k, d);
  });

  const rooms: AnnotatedRoom[] = seg.rooms.map((r, k) => {
    const name = nameFor.get(k);
    const dim = dimFor.get(k);
    const xs = r.polygon.map((p) => p.x);
    const ys = r.polygon.map((p) => p.y);
    const spanX: [number, number] = [Math.min(...xs), Math.max(...xs)];
    const spanY: [number, number] = [Math.min(...ys), Math.max(...ys)];
    let dimensions: AnnotatedDimension[] | undefined;
    if (dim) {
      // Pair the two printed values with the room's extents in whichever order is consistent.
      const [p, q] = dim.parsed.values as [number, number];
      const wx = spanX[1] - spanX[0];
      const wy = spanY[1] - spanY[0];
      const err = (a: number, b: number) => Math.abs(Math.log(wx / a / (wy / b)));
      const xFirst = err(p, q) <= err(q, p);
      dimensions = [
        {
          id: `${r.id}#x`,
          meters: xFirst ? p : q,
          axis: 'x',
          span: spanX,
          text: dim.parsed.raw,
          confidence: dim.confidence,
        },
        {
          id: `${r.id}#y`,
          meters: xFirst ? q : p,
          axis: 'y',
          span: spanY,
          text: dim.parsed.raw,
          confidence: dim.confidence,
        },
      ];
    }
    return {
      id: r.id,
      name: name ? titleCase(name.match.raw) : 'Unknown Room',
      type: name ? name.match.type : 'unknown',
      labelSource: name ? 'plan-label' : 'unknown',
      confidence: name ? name.match.confidence : 0.5,
      ...(name
        ? {
            labelId: labels.find(
              (l) => l.text === name.match.raw && Math.abs(l.at.x - (name.box.x0 + name.box.x1) / 2) < 1,
            )?.id,
          }
        : {}),
      ...(name
        ? {
            label: {
              text: name.match.raw,
              ...(dim
                ? { dimensionsText: dim.parsed.raw, dimensions: dim.parsed.values as [number, number] }
                : {}),
            },
          }
        : {}),
      polygon: r.polygon.map(round2),
      ...(dimensions ? { dimensions } : {}),
      ...(name?.match.type === 'balcony' ? { exterior: true } : {}),
    } as AnnotatedRoom;
  });

  // ── Calibration (priority: reference → printed → user → estimate) ─────────────────
  const hingedWidths = ops.openings
    .filter((o) => o.kind === 'door' && o.doorKind === 'hinged')
    .map((o) => o.to - o.from)
    .sort((a, b) => a - b);
  const typicalDoor = opts.typicalDoorWidthMeters ?? 0.8;
  const typicalWall = opts.typicalExternalWallMeters ?? 0.25;
  const estimate =
    hingedWidths.length >= 2
      ? {
          value: hingedWidths[Math.floor(hingedWidths.length / 2)]! / typicalDoor,
          basis: `median of ${hingedWidths.length} detected door widths, assumed ${typicalDoor} m`,
        }
      : { value: profile.major / typicalWall, basis: `external wall thickness, assumed ${typicalWall} m` };
  // Printed single lengths measured along their dimension lines.
  const dimLines = text
    ? measureDimensionLines(
        pre.gray,
        walls0.wallMask,
        lineThreshold,
        text.dimensions
          .filter((d) => d.parsed.values.length === 1)
          .map((d) => ({
            meters: d.parsed.values[0]!,
            text: d.parsed.raw,
            box: d.box,
            confidence: d.confidence,
          })),
      )
    : [];
  const references: AnnotatedDimension[] = [
    ...(opts.reference
      ? [
          {
            id: 'user-reference',
            kind: 'reference' as const,
            meters: opts.reference.meters,
            a: opts.reference.a,
            b: opts.reference.b,
          },
        ]
      : []),
    ...dimLines.map((l, i) => ({
      id: `dimension-line-${i + 1}`,
      kind: 'printed' as const,
      meters: l.meters,
      text: l.text,
      a: round2(l.a),
      b: round2(l.b),
      confidence: l.confidence,
    })),
  ];
  const calibration: FloorPlanAnnotations['calibration'] = {
    ...(references.length ? { references } : {}),
    ...(opts.pixelsPerMeter ? { manualPixelsPerMeter: opts.pixelsPerMeter } : {}),
    estimatedPixelsPerMeter: { value: +estimate.value.toFixed(3), basis: estimate.basis },
  };
  const calStage = await run(
    'calibration',
    () => {
      try {
        return calibrateAnnotations({ rooms, calibration });
      } catch (e) {
        if (!(e instanceof CalibrationError)) throw e;
        // Printed dimensions all disagree: drop them and fall back to the next strategy.
        warnings.push(`Printed dimensions could not be used (${e.message}).`);
        rooms.forEach((r) => delete r.dimensions);
        return calibrateAnnotations({ rooms, calibration });
      }
    },
    (c) => ({
      status: c.method === 'estimated' ? 'partial' : 'ok',
      message: `${c.method}: ${c.pixelsPerMeter.toFixed(2)} px/m (${c.confidence} confidence)`,
    }),
  );
  const calReport = calibrationReport(calStage);
  const ppm = calStage.pixelsPerMeter;
  // Plausibility: a misread printed value would scale the whole plan wrongly. Compare with what
  // typical door widths imply and flag (never silently override) a large disagreement.
  if (
    calStage.method === 'dimension-labels' &&
    hingedWidths.length >= 2 &&
    Math.abs(ppm / estimate.value - 1) > 0.3
  ) {
    warnings.push(
      `The printed dimensions imply doors about ${((hingedWidths[Math.floor(hingedWidths.length / 2)]! / ppm) * 100).toFixed(0)} cm wide, which is unusual; check the scale.`,
    );
  }

  // Unnamed rooms: small enclosed spaces are almost always cupboards; say so, uncertainly.
  for (const r of rooms) {
    if (r.labelSource !== 'unknown') continue;
    const areaM2 = polygonArea(r.polygon.map((p) => ({ x: p.x, z: p.y }))) / ppm ** 2;
    if (areaM2 < 1.5)
      Object.assign(r, {
        name: 'Cupboard',
        type: 'storage' as RoomType,
        labelSource: 'inferred',
        confidence: 0.5,
        note: 'Small unlabelled enclosed space; assumed storage.',
      });
  }
  numberDuplicateNames(rooms, ppm);
  for (const win of windows) {
    if (Math.abs(win.span[1] - win.span[0]) / ppm >= 1.6) win.kind = 'large';
  }

  // Exterior rooms (balconies, terraces) are outside the unit: walls facing them are external
  // walls, and they are not part of the footprint or the internal area.
  rooms.forEach((r, k) => {
    if (r.exterior) outsideRegions.add(Number(seg.rooms[k]!.id.slice('room-'.length)));
  });
  for (const w of ops.walls) if (Math.max(sideRegion(w, 1), sideRegion(w, -1)) > 0.5) exterior.add(w.id);
  for (const w of annWalls) if (exterior.has(w.id)) w.kind = 'exterior';
  const unitMask = newMask(img.width, img.height);
  for (let i = 0; i < unitMask.data.length; i++)
    unitMask.data[i] = outsideRegions.has(seg.regionOf[i]!) ? 0 : 1;
  for (const r of rails) fillConvexPolygon(unitMask, wallPolygon(r), 0);
  const fullImage = { x0: 0, y0: 0, x1: img.width, y1: img.height };
  const inMask = (m: typeof unitMask) => (x: number, y: number) =>
    x >= 0 && y >= 0 && x < img.width && y < img.height && m.data[y * img.width + x] === 1;
  const footprint =
    rails.length || outsideRegions.size > 1 ? traceRegion(inMask(unitMask), fullImage) : seg.footprint;
  // Interior envelope for the area cross-check: inside the unit, excluding external walls.
  const envelopeMask = { ...unitMask, data: unitMask.data.slice() };
  for (const w of ops.walls) if (exterior.has(w.id)) fillConvexPolygon(envelopeMask, wallPolygon(w), 0);
  const envelope = traceRegion(inMask(envelopeMask), fullImage, 1.5);

  const annotations = await run(
    'annotations',
    (): FloorPlanAnnotations => ({
      formatVersion: 1,
      id: source.id,
      name: text?.floorLabel ? `${text.floorLabel} (extracted)` : `Extracted plan ${source.id}`,
      ...(text?.floorLabel ? { floorLabel: text.floorLabel } : {}),
      level: 0,
      source: { method: 'automatic', producer: 'cv-extractor@1' },
      image: { file: source.file, widthPx: img.width, heightPx: img.height },
      originPx: footprint.length
        ? { x: Math.min(...footprint.map((p) => p.x)), y: Math.min(...footprint.map((p) => p.y)) }
        : { x: 0, y: 0 },
      ...(text?.reportedAreaM2
        ? { reportedArea: { m2: text.reportedAreaM2, note: 'Read from the plan by OCR' } }
        : {}),
      ...(envelope.length >= 3 ? { internalEnvelope: envelope.map(round2) } : {}),
      footprint: footprint.map(round2),
      calibration,
      defaults: { ...DEFAULT_ASSUMED_HEIGHTS, ...opts.defaults },
      walls: annWalls,
      doors,
      windows,
      rooms,
      fixtures: [],
      labels,
      drawingNotes: unplacedLabels.map((t, i) => ({
        id: `unplaced-label-${i + 1}`,
        message: `Label "${t}" is not inside any enclosed room; that space (e.g. a balcony bounded only by railings) was not reconstructed.`,
      })),
    }),
    (a) => ({
      status: 'ok',
      message: `${a.walls.length} walls, ${a.doors.length} doors/openings, ${a.windows.length} windows, ${a.rooms.length} rooms`,
    }),
  );

  const confidence = summariseConfidence(annotations, calReport);
  annotations.source.confidence = confidence.overall;
  const review = assessExtraction(annotations, calReport, {
    unplacedLabels,
    refinedDimensions: text?.dimensions.filter((d) => d.refined).map((d) => d.parsed.raw) ?? [],
    warnings,
  });
  return { annotations, stages, warnings, errors, confidence, calibration: calReport, review };
}

/** Summary of a calibration for extraction results and review. */
export function calibrationReport(c: ScaleCalibration): ExtractionCalibrationReport {
  return {
    strategy: c.method,
    pixelsPerMeter: c.pixelsPerMeter,
    confidence: c.confidence,
    ...(c.basis ? { basis: c.basis } : {}),
    samplesUsed: c.samples.filter((s) => s.accepted).length,
    samplesRejected: c.samples.filter((s) => !s.accepted).length,
  };
}

function hingeMinMax(
  o: DetectedOpening,
  pFrom: PxPoint,
  pTo: PxPoint,
  dom: (p: PxPoint) => number,
): 'min' | 'max' {
  const hingeP = o.hinge === 'end' ? pTo : pFrom;
  const other = o.hinge === 'end' ? pFrom : pTo;
  return dom(hingeP) <= dom(other) ? 'min' : 'max';
}

function swingDirection(w: DetectedWall, o: DetectedOpening): PxDirection {
  const n = segNormal(w);
  const s = o.swingSide ?? 1;
  const v = { x: n.x * s, y: n.y * s };
  const options: [PxDirection, number][] = [
    ['up', -v.y],
    ['down', v.y],
    ['left', -v.x],
    ['right', v.x],
  ];
  return options.sort((a, b) => b[1] - a[1])[0]![0];
}

const round2 = (p: PxPoint): PxPoint => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) });

/** "LIVING / DINING" → "Living / Dining"; two-letter abbreviations (WC) stay capitals. */
function titleCase(s: string): string {
  return s.replace(/[A-Za-z][A-Za-z.]*/g, (w) =>
    w.length <= 2 && w === w.toUpperCase() ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase(),
  );
}

/** "Bedroom", "Bedroom" → "Bedroom 1", "Bedroom 2" (largest first). The printed label is kept. */
function numberDuplicateNames(rooms: AnnotatedRoom[], ppm: number): void {
  const groups = new Map<string, AnnotatedRoom[]>();
  for (const r of rooms)
    if (r.labelSource === 'plan-label') groups.set(r.name, [...(groups.get(r.name) ?? []), r]);
  for (const [name, list] of groups) {
    if (list.length < 2) continue;
    list
      .sort(
        (a, b) =>
          polygonArea(b.polygon.map((p) => ({ x: p.x, z: p.y }))) -
          polygonArea(a.polygon.map((p) => ({ x: p.x, z: p.y }))),
      )
      .forEach((r, i) => (r.name = `${name} ${i + 1}`));
  }
  void ppm;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Mean confidence per category and a weighted overall score (unknown confidence counts as 1). */
export function summariseConfidence(
  a: FloorPlanAnnotations,
  cal: ExtractionCalibrationReport,
): ExtractionConfidence {
  const walls = mean(a.walls.map((w) => w.confidence ?? 1));
  const doors = mean(a.doors.map((d) => d.confidence ?? 1));
  const windows = mean(a.windows.map((w) => w.confidence ?? 1));
  const rooms = mean(a.rooms.map((r) => r.confidence ?? 1));
  const calibration = cal.confidence === 'high' ? 0.95 : cal.confidence === 'medium' ? 0.75 : 0.4;
  const parts: [number, number][] = [
    [walls, 0.35],
    [rooms, 0.25],
    [calibration, 0.15],
    ...(a.doors.length ? ([[doors, 0.15]] as [number, number][]) : []),
    ...(a.windows.length ? ([[windows, 0.1]] as [number, number][]) : []),
  ];
  const wsum = parts.reduce((s, [, w]) => s + w, 0);
  const overall = parts.reduce((s, [v, w]) => s + v * w, 0) / wsum;
  const r = (x: number) => +x.toFixed(3);
  return {
    walls: r(walls),
    doors: r(doors),
    windows: r(windows),
    rooms: r(rooms),
    calibration: r(calibration),
    overall: r(overall),
  };
}
