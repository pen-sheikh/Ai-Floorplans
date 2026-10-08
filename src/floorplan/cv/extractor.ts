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
  DocumentCheck,
  ExtractionCalibrationReport,
  ExtractionConfidence,
  ExtractionResult,
  ExtractionReview,
  ExtractionStageName,
  ExtractionStageReport,
  FloorPlanExtractor,
  FloorPlanSource,
  ReviewProblem,
} from '../extraction';
import { pxWallGeometry } from '../wallGeometry';
import { EvidenceRoomClassifier, type RoomClassifier, type RoomEvidence } from './classify';
import { measureDimensionLines } from './dimensionLines';
import { assessDocument, measureDocument } from './documentCheck';
import { detectOpenings, type DetectedOpening } from './openings';
import { preprocessImage, wallThicknessProfile } from './preprocess';
import { detectHollowBands } from './railings';
import { fillConvexPolygon, newMask, type RgbaImage } from './raster';
import { assessComponents, assessExtraction, roomTitle } from './review';
import {
  inferBoundaries,
  segmentRooms,
  traceRegion,
  wallPolygon,
  type InferredBoundary,
  type RoomSegmentation,
} from './rooms';
import { sanitizeAnnotations } from './sanitize';
import { assessStructure } from './structure';
import { detectTintBands } from './tintBands';
import { combineRoomNames, readPlanText, type OcrProvider, type PlanText, type RoomNameMatch } from './text';
import { proposeTextLines, textOnlyImage } from './textRegions';
import { detectWalls, segDir, segNormal, type DetectedWall } from './walls';

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
  /** Room meaning (geometry is never delegated). Default: evidence rules. */
  classifier?: RoomClassifier;
  /** Extract even when the image does not look like a floor plan. */
  force?: boolean;
  onProgress?: (stage: ExtractionStageName, message: string) => void;
}

const STAGE_LABEL: Record<ExtractionStageName, string> = {
  document: 'Checking the image…',
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
  const stageProblems: ReviewProblem[] = [];
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

  // ── Is this probably a floor plan? (never a certainty) ────────────────────────────
  const document: DocumentCheck = await run(
    'document',
    () => assessDocument(measureDocument(pre)),
    (d) => ({
      status: d.verdict === 'UNLIKELY_FLOOR_PLAN' ? 'failed' : 'ok',
      confidence: d.confidence,
      message: `${d.verdict} (${Math.round(d.confidence * 100)} %)`,
    }),
  );
  if (document.verdict === 'UNLIKELY_FLOOR_PLAN' && !opts.force)
    return notAFloorPlan(img, source, document, stages);

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
  const bridged = await run(
    'openings',
    () => detectOpenings({ gray: pre.gray, wallMask: walls0.wallMask, profile, lineThreshold }, walls0.walls),
    (o) => ({
      status: 'ok',
      message: `${o.openings.filter((x) => x.kind === 'door').length} doors, ${o.openings.filter((x) => x.kind === 'window').length} windows, ${o.openings.filter((x) => x.kind === 'opening').length} uncertain openings`,
    }),
  );
  // ── Structural walls versus furniture, symbols, textures and annotation ───────────
  // Judged after openings are bridged, so wall pieces between windows count as one wall.
  const structure = assessStructure(bridged.walls, profile);
  const removedIds = new Set(structure.removed.map((w) => w.id));
  const ops = { walls: structure.walls, openings: bridged.openings.filter((o) => !removedIds.has(o.wallId)) };
  if (structure.removed.length) {
    stageProblems.push({
      severity: 'info',
      code: 'non-structural-ignored',
      category: 'structural_ambiguity',
      impact: 'missing-optional',
      message: `${structure.removed.length} heavy stroke${structure.removed.length > 1 ? 's' : ''} not connected to the wall structure (furniture, symbols, texture or bold annotation) ${structure.removed.length > 1 ? 'were' : 'was'} ignored.`,
    });
  }
  // ── Structural coherence: can this drawing style be read at all? ──────────────────
  // Walls drawn as thin lines (or a photo/render whose only "thick" ink is linework) give a
  // line-thin wall class and a flood of candidates that cannot be told apart from furniture,
  // hatching and text. That is reported as a failure of this style, not turned into a model.
  const lineThin = profile.major <= Math.max(5, 0.003 * Math.min(img.width, img.height));
  const incoherent = lineThin && walls0.walls.length > 200;
  if (incoherent) {
    stageProblems.push({
      severity: 'error',
      code: 'thin-line-drawing',
      category: 'structural_ambiguity',
      impact: 'geometry-failure',
      message: `Walls appear to be drawn as thin lines (thickest wall class ≈ ${profile.major} px) and ${walls0.walls.length} candidate walls could not be separated from furniture, hatching and text. This drawing style is not supported yet; no model is built from it.`,
    });
  } else if (walls0.walls.length > 600) {
    stageProblems.push({
      severity: 'warning',
      code: 'dense-drawing',
      category: 'structural_ambiguity',
      impact: 'geometry-uncertain',
      message: `The drawing is very dense (${walls0.walls.length} wall candidates: symbols, hatching or several units on one sheet); walls and rooms are unreliable — review carefully.`,
    });
  }
  // Windows drawn as coloured bands (no glazing lines): walls that carry a window.
  const tintWalls = incoherent ? [] : detectTintBands(pre, profile, walls0.wallMask);
  if (tintWalls.length) {
    stageProblems.push({
      severity: 'info',
      code: 'coloured-windows',
      category: 'window_detection',
      impact: 'semantic-uncertainty',
      message: `${tintWalls.length} window${tintWalls.length > 1 ? 's were' : ' was'} read from coloured bands in the wall line (no glazing lines drawn).`,
      elementIds: tintWalls.map((w) => w.id),
    });
  }
  const doubtfulIds = structure.doubtful.map((w) => w.id);
  if (doubtfulIds.length) {
    stageProblems.push({
      severity: 'warning',
      code: 'possible-annotation-walls',
      category: 'annotation_conflict',
      impact: 'geometry-uncertain',
      message: `${doubtfulIds.length === 1 ? 'One wall' : `${doubtfulIds.length} walls`} may be annotation, furniture or dimension lines rather than structural walls (${doubtfulIds.slice(0, 6).join(', ')}${doubtfulIds.length > 6 ? ', …' : ''}).`,
      elementIds: doubtfulIds,
    });
  }

  let text: PlanText | null = null;
  if (opts.ocr) {
    try {
      text = await run(
        'text',
        () => {
          // Bold display text can pass the wall filter, so glyphs are looked for in all ink
          // (long walls fail the glyph shape test anyway), with a size limit that scales.
          const proposals = proposeTextLines(pre.ink, newMask(img.width, img.height), {
            maxCharPx: Math.max(40, Math.round(0.035 * Math.min(img.width, img.height))),
          });
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

  // ── Recognised text is not structure ──────────────────────────────────────────────
  const textBoxes = (text?.names ?? []).map((n) => n.box);
  if (textBoxes.length) {
    const inText = (p: PxPoint) =>
      textBoxes.some((b) => p.x >= b.x0 - 2 && p.x <= b.x1 + 2 && p.y >= b.y0 - 2 && p.y <= b.y1 + 2);
    const before = ops.walls.length;
    ops.walls = ops.walls.filter((w) => !(inText(w.a) && inText(w.b)));
    ops.openings = ops.openings.filter((o) => ops.walls.some((w) => w.id === o.wallId));
    if (ops.walls.length < before) {
      for (const b of textBoxes) {
        for (let y = Math.max(0, Math.floor(b.y0)); y < Math.min(img.height, Math.ceil(b.y1)); y++) {
          for (let x = Math.max(0, Math.floor(b.x0)); x < Math.min(img.width, Math.ceil(b.x1)); x++)
            walls0.wallMask.data[y * img.width + x] = 0;
        }
      }
    }
  }

  // ── Rooms: closed walls first; then close open boundaries — only with evidence ─────
  const labelPoints = (text?.names ?? []).map((n) => ({
    x: (n.box.x0 + n.box.x1) / 2,
    y: (n.box.y0 + n.box.y1) / 2,
  }));
  const { seg, rails, closures } = await run(
    'rooms',
    () => {
      const rails = detectHollowBands(
        { gray: pre.gray, wallMask: walls0.wallMask, lineThreshold, profile },
        ops.walls,
      );
      const all = [...ops.walls, ...rails, ...tintWalls];
      const segment = (extra: InferredBoundary[]) =>
        segmentRooms(all, img.width, img.height, profile.major, walls0.wallMask, {
          extraBarriers: extra.map((c) => ({ a: c.a, b: c.b, thickness: Math.max(2, 0.4 * profile.minor) })),
        });
      const plain = segment([]);
      const candidates = inferBoundaries(all, profile.major, walls0.wallMask);
      if (!candidates.length) return { seg: plain, rails, closures: [] as InferredBoundary[] };
      const closed = segment(candidates);
      // Interior gaps are usually intentional (open plan, alcoves). A closure is kept only when
      // it seals the building outline, or separates two printed room names.
      const useful = candidates.filter((c) => sealsOrSeparates(plain, closed, c, profile.major, labelPoints));
      const seg = useful.length === candidates.length ? closed : useful.length ? segment(useful) : plain;
      return { seg, rails, closures: useful };
    },
    ({ seg: s, rails: r, closures: c }) => ({
      status: s.rooms.length ? 'ok' : 'failed',
      message: `${s.rooms.length} enclosed rooms${r.length ? `; ${r.length} railings` : ''}${c.length ? `; ${c.length} open boundaries closed by inference` : ''}`,
    }),
  );

  // ── Walls → annotation walls (exterior if one side is outside space) ──────────────
  // Outside = open space around the plan, plus exterior rooms (balconies) once named below.
  const outsideRegions = new Set<number>([-1]);
  const sideRegions = (w: { a: PxPoint; b: PxPoint; thickness: number }, side: 1 | -1) => {
    const d = segDir(w);
    const n = segNormal(w);
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const out: number[] = [];
    for (let t = 0.15 * L; t <= 0.85 * L; t += Math.max(4, L / 12)) {
      const x = Math.floor(w.a.x + d.x * t + n.x * side * (w.thickness / 2 + 3));
      const y = Math.floor(w.a.y + d.y * t + n.y * side * (w.thickness / 2 + 3));
      if (x >= 0 && y >= 0 && x < img.width && y < img.height) out.push(seg.regionOf[y * img.width + x]!);
    }
    return out;
  };
  const outsideShare = (w: DetectedWall, side: 1 | -1) => {
    const r = sideRegions(w, side);
    return r.length ? r.filter((k) => outsideRegions.has(k)).length / r.length : 0;
  };
  const exterior = new Set<string>();
  const annWalls: AnnotatedWall[] = [...ops.walls, ...tintWalls, ...rails].map((w) => ({
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
  /** Rooms on either side of each opening (for classification evidence). */
  const openingRooms: { kind: 'door' | 'window' | 'opening'; rooms: number[] }[] = [];
  for (const o of ops.openings) {
    const w = wallById.get(o.wallId)!;
    const g = pxWallGeometry(annWallById.get(o.wallId)!);
    const at = (t: number) => ({ x: w.a.x + segDir(w).x * t, y: w.a.y + segDir(w).y * t });
    const dom = (p: PxPoint) => (g.dominant === 'x' ? p.x : p.y);
    const pFrom = at(o.from);
    const pTo = at(o.to);
    const span = [dom(pFrom), dom(pTo)].sort((x, y) => x - y).map((v) => +v.toFixed(2)) as [number, number];
    const m = at((o.from + o.to) / 2);
    const sidesAt = [1, -1].map((s) => {
      const n = segNormal(w);
      const x = Math.floor(m.x + n.x * s * (w.thickness / 2 + 3));
      const y = Math.floor(m.y + n.y * s * (w.thickness / 2 + 3));
      return x >= 0 && y >= 0 && x < img.width && y < img.height ? seg.regionOf[y * img.width + x]! : -1;
    });
    openingRooms.push({ kind: o.kind, rooms: sidesAt.filter((k) => k > 0) });
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
      ...(o.kind !== 'opening' && o.swingConfidence !== undefined
        ? { swingConfidence: o.swingConfidence }
        : {}),
      ...(o.kind === 'opening'
        ? { note: 'Gap between walls with no door symbol: may be an open doorway or a missing door.' }
        : {}),
    });
  }

  for (const w of tintWalls) {
    const g = pxWallGeometry(annWallById.get(w.id)!);
    const span = [g.dominant === 'x' ? g.a.x : g.a.y, g.dominant === 'x' ? g.b.x : g.b.y]
      .sort((x, y) => x - y)
      .map((v) => +v.toFixed(2)) as [number, number];
    windows.push({
      id: `win-${w.id}`,
      wallId: w.id,
      span,
      kind: 'standard',
      confidence: w.confidence,
      note: 'Drawn as a coloured band; read as a window.',
    });
    const m = mid(w);
    const n = segNormal(w);
    const sides = [1, -1].map((s) => {
      const x = Math.floor(m.x + n.x * s * (w.thickness / 2 + 3));
      const y = Math.floor(m.y + n.y * s * (w.thickness / 2 + 3));
      return x >= 0 && y >= 0 && x < img.width && y < img.height ? seg.regionOf[y * img.width + x]! : -1;
    });
    openingRooms.push({ kind: 'window', rooms: sides.filter((k) => k > 0) });
  }

  // ── Labels and printed dimensions placed in rooms ─────────────────────────────────
  const roomPolys = seg.rooms.map((r) => r.polygon.map((p) => ({ x: p.x, z: p.y })));
  const inRoom = (box: { x0: number; y0: number; x1: number; y1: number }) => {
    const c = { x: (box.x0 + box.x1) / 2, z: (box.y0 + box.y1) / 2 };
    return roomPolys.findIndex((poly) => pointInPolygon(c, poly));
  };
  const labels: AnnotatedLabel[] = [];
  const namesIn = new Map<number, PlanText['names']>();
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
    namesIn.set(k, [...(namesIn.get(k) ?? []), n]);
  });
  // One name per room; several names in one space are combined (open plan) or flagged.
  const nameFor = new Map<number, { match: RoomNameMatch; box: PlanText['names'][number]['box'] }>();
  for (const [k, list] of namesIn) {
    const { match, plausible } = combineRoomNames(list.map((n) => n.match));
    const box = list.reduce((b, n) => (n.box.y1 - n.box.y0 > b.y1 - b.y0 ? n.box : b), list[0]!.box);
    nameFor.set(k, { match, box });
    if (!plausible) {
      stageProblems.push({
        severity: 'warning',
        code: 'merged-rooms',
        category: 'room_boundary',
        impact: 'geometry-uncertain',
        message: `One enclosed space carries the labels ${list.map((n) => `"${n.match.raw}"`).join(', ')}: it is probably ${list.length} rooms whose dividing wall was not found.`,
        elementId: seg.rooms[k]!.id,
      });
    }
  }
  // Room size labels; metric is preferred where a plan prints both systems.
  for (const d of text?.dimensions ?? []) {
    const k = inRoom(d.box);
    if (k < 0 || d.parsed.values.length !== 2) continue;
    const prev = dimFor.get(k);
    if (!prev || (prev.parsed.unit === 'ft' && d.parsed.unit !== 'ft')) dimFor.set(k, d);
  }

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
      name: name ? name.match.display : 'Unknown Room',
      type: name ? name.match.type : 'unknown',
      labelSource: name ? 'plan-label' : 'unknown',
      ...(name
        ? {
            labelId: labels.find(
              (l) =>
                Math.abs(l.at.x - (name.box.x0 + name.box.x1) / 2) < 1 &&
                Math.abs(l.at.y - (name.box.y0 + name.box.y1) / 2) < 1,
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
          basis: `typical door width (median of ${hingedWidths.length} detected doors, assumed ${typicalDoor} m)`,
        }
      : {
          value: profile.major / typicalWall,
          basis: `typical external wall thickness (assumed ${typicalWall} m)`,
        };
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
    stageProblems.push({
      severity: 'warning',
      code: 'scale-implausible',
      category: 'scale',
      impact: 'geometry-uncertain',
      message: `The printed dimensions imply doors about ${((hingedWidths[Math.floor(hingedWidths.length / 2)]! / ppm) * 100).toFixed(0)} cm wide, which is unusual; check the scale.`,
    });
  }

  // ── Room geometry confidence, from how much of the boundary is inferred ───────────
  const area = (poly: PxPoint[]) => polygonArea(poly.map((p) => ({ x: p.x, z: p.y })));
  rooms.forEach((r) => {
    const inferred = inferredShare(r.polygon, closures, Math.max(3, profile.minor));
    const geometry = +Math.max(0.3, 0.95 - 0.9 * inferred).toFixed(3);
    r.geometryConfidence = geometry;
    if (inferred > 0.05) {
      const used = closures.filter((c) =>
        r.polygon.some((p) => distToSeg(p, c.a, c.b) < Math.max(3, profile.minor) + 1),
      );
      const longest = Math.max(...used.map((c) => c.gapPx), 0) / ppm;
      stageProblems.push({
        severity: 'warning',
        code: 'inferred-room-boundary',
        category: 'room_boundary',
        impact: 'geometry-uncertain',
        message: `${roomTitle(r, rooms)} has an uncertain boundary: ${Math.round(inferred * 100)} % of its outline was closed across open gaps (up to ${longest.toFixed(1)} m) where no wall is drawn.`,
        elementId: r.id,
      });
    }
  });

  // ── Room meaning: label, size, openings, neighbours (never the geometry) ──────────
  const classifier = opts.classifier ?? new EvidenceRoomClassifier();
  const railRooms = new Set<number>();
  for (const rw of rails)
    for (const s of [1, -1] as const) for (const k of sideRegions(rw, s)) if (k > 0) railRooms.add(k);
  rooms.forEach((r, k) => {
    const regionId = Number(seg.rooms[k]!.id.slice('room-'.length));
    const xs = r.polygon.map((p) => p.x);
    const ys = r.polygon.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const touching = openingRooms.filter((o) => o.rooms.includes(regionId));
    const neighbours = new Set(touching.flatMap((o) => o.rooms).filter((x) => x !== regionId));
    const name = nameFor.get(k);
    const evidence: RoomEvidence = {
      ...(name ? { label: name.match } : {}),
      areaM2: area(r.polygon) / ppm ** 2,
      scaleMeasured: calStage.method !== 'estimated',
      aspect: Math.max(w, h) / Math.max(1, Math.min(w, h)),
      doors: touching.filter((o) => o.kind === 'door').length,
      windows: touching.filter((o) => o.kind === 'window').length,
      openings: touching.filter((o) => o.kind === 'opening').length,
      railing: railRooms.has(regionId),
      exteriorShare: 0,
      neighbours: neighbours.size,
    };
    const c = classifier.classify(evidence);
    r.labelConfidence = +c.labelConfidence.toFixed(3);
    r.classificationConfidence = +c.confidence.toFixed(3);
    r.classification = {
      evidence: c.evidence,
      ...(c.suggestedType ? { suggestedType: c.suggestedType } : {}),
    };
    r.type = c.type;
    if (!name && c.type !== 'unknown') {
      Object.assign(r, { name: inferredName(c.type, evidence.areaM2!), labelSource: 'inferred' });
    }
    if (c.type === 'balcony') r.exterior = true;
    // An unlabelled space with no door, opening or window may be an object (furniture,
    // fitting) drawn with heavy lines rather than a room: geometry stays, confidence drops.
    if (!name && evidence.doors + evidence.openings + evidence.windows === 0) {
      r.geometryConfidence = +((r.geometryConfidence ?? 0.95) * 0.6).toFixed(3);
      r.classification.evidence.push(
        'no door, opening or window found: may be a closed object rather than a room',
      );
    }
    // Overall: geometry, tempered by how sure the meaning is.
    r.confidence = +(
      (r.geometryConfidence ?? 0.95) * (c.type === 'unknown' ? 0.7 : 0.7 + 0.3 * c.confidence)
    ).toFixed(3);
  });
  numberDuplicateNames(rooms);
  for (const win of windows) {
    if (Math.abs(win.span[1] - win.span[0]) / ppm >= 1.6) win.kind = 'large';
  }

  // Exterior rooms (balconies, terraces) are outside the unit: walls facing them are external
  // walls, and they are not part of the footprint or the internal area.
  rooms.forEach((r, k) => {
    if (r.exterior) outsideRegions.add(Number(seg.rooms[k]!.id.slice('room-'.length)));
  });
  for (const w of [...ops.walls, ...tintWalls])
    if (Math.max(outsideShare(w, 1), outsideShare(w, -1)) > 0.5) exterior.add(w.id);
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

  const assembled = await run(
    'annotations',
    (): FloorPlanAnnotations => ({
      formatVersion: 1,
      id: source.id,
      name: text?.floorLabel ? `${text.floorLabel} (extracted)` : `Extracted plan ${source.id}`,
      ...(text?.floorLabel ? { floorLabel: text.floorLabel } : {}),
      level: 0,
      source: { method: 'automatic', producer: 'cv-extractor@2' },
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
        message: `Label "${t}" is not inside any enclosed room; that space was not reconstructed.`,
      })),
      ...(closures.length
        ? {
            inferredBoundaries: closures.map((c, i) => ({
              id: `inferred-boundary-${i + 1}`,
              a: round2(c.a),
              b: round2(c.b),
              reason: `Open gap of ${(c.gapPx / ppm).toFixed(2)} m closed from wall ${c.fromWall}${c.toWall ? ` to wall ${c.toWall}` : ''}`,
            })),
          }
        : {}),
    }),
    (a) => ({
      status: 'ok',
      message: `${a.walls.length} walls, ${a.doors.length} doors/openings, ${a.windows.length} windows, ${a.rooms.length} rooms`,
    }),
  );

  // One bad element must not invalidate the plan: repair or drop it, and say so.
  const { annotations, problems: sanitizeProblems } = sanitizeAnnotations(assembled);
  const confidence = summariseConfidence(annotations, calReport);
  annotations.source.confidence = confidence.overall;
  const review = assessExtraction(annotations, calReport, {
    unplacedLabels,
    refinedDimensions: text?.dimensions.filter((d) => d.refined).map((d) => d.parsed.raw) ?? [],
    warnings,
    stageProblems: [...stageProblems, ...sanitizeProblems],
    document,
  });
  return { annotations, stages, warnings, errors, confidence, calibration: calReport, review };
}

/** Early stop: the image does not look like a floor plan. Nothing is guessed from it. */
function notAFloorPlan(
  img: RgbaImage,
  source: FloorPlanSource,
  document: DocumentCheck,
  stages: ExtractionStageReport[],
): ExtractionResult {
  const annotations: FloorPlanAnnotations = {
    formatVersion: 1,
    id: source.id,
    name: `Extracted plan ${source.id}`,
    level: 0,
    source: { method: 'automatic', producer: 'cv-extractor@2', confidence: 0 },
    image: { file: source.file, widthPx: img.width, heightPx: img.height },
    originPx: { x: 0, y: 0 },
    footprint: [],
    defaults: { ...DEFAULT_ASSUMED_HEIGHTS },
    walls: [],
    doors: [],
    windows: [],
    rooms: [],
    fixtures: [],
    drawingNotes: [],
  };
  const problem: ReviewProblem = {
    severity: 'error',
    code: 'not-a-floor-plan',
    category: 'image_quality',
    impact: 'geometry-failure',
    message: `This image does not look like a floor plan (${Math.round(document.confidence * 100)} % likely): ${document.evidence.join('; ')}. Extraction was stopped; nothing was guessed from it.`,
  };
  // Nothing was extracted, so nothing else is reported: the one reason is the whole review.
  const review: ExtractionReview = {
    status: 'failed',
    problems: [problem],
    components: assessComponents(annotations, undefined, [problem]),
    document,
  };
  return { annotations, stages, warnings: [], errors: [problem.message], review };
}

const mid = (w: { a: PxPoint; b: PxPoint }) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });

function distToSeg(p: PxPoint, a: PxPoint, b: PxPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/**
 * Keep an inferred boundary only with evidence for it: it seals the building outline (one side
 * leaked to the outside before and is a room now), or it separates two printed room names
 * that were in one space before.
 */
function sealsOrSeparates(
  plain: RoomSegmentation,
  closed: RoomSegmentation,
  c: InferredBoundary,
  major: number,
  labels: readonly PxPoint[],
): boolean {
  const m = mid(c);
  const L = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) || 1;
  const n = { x: -(c.b.y - c.a.y) / L, y: (c.b.x - c.a.x) / L };
  const regionAt = (seg: RoomSegmentation, p: PxPoint) => {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return x >= 0 && y >= 0 && x < seg.width && y < seg.height ? seg.regionOf[y * seg.width + x]! : -1;
  };
  const off = Math.max(3, 0.3 * major);
  const s1 = { x: m.x + n.x * off, y: m.y + n.y * off };
  const s2 = { x: m.x - n.x * off, y: m.y - n.y * off };
  const [c1, c2] = [regionAt(closed, s1), regionAt(closed, s2)];
  if (c1 === c2 || c1 === 0 || c2 === 0) return false;
  const [p1, p2] = [regionAt(plain, s1), regionAt(plain, s2)];
  // Seals: before, this spot was part of the outside; now one side is an enclosed room.
  if ((p1 === -1 || p2 === -1) && (c1 > 0 || c2 > 0)) return true;
  // Separates labels: two printed names shared one space before and now have one each.
  const inRegion = (seg: RoomSegmentation, k: number) => labels.filter((p) => regionAt(seg, p) === k).length;
  return (
    p1 === p2 && p1 > 0 && inRegion(closed, c1) >= 1 && inRegion(closed, c2) >= 1 && inRegion(plain, p1) >= 2
  );
}

/** Share of a room outline running along inferred (not drawn) boundaries. */
function inferredShare(poly: PxPoint[], closures: InferredBoundary[], tol: number): number {
  if (!closures.length) return 0;
  let total = 0;
  let near = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    for (let t = 0; t < L; t += 2) {
      const p = { x: a.x + ((b.x - a.x) * t) / L, y: a.y + ((b.y - a.y) * t) / L };
      total++;
      if (closures.some((c) => distToSeg(p, c.a, c.b) <= tol + 1)) near++;
    }
  }
  return total ? near / total : 0;
}

/** Neutral names for rooms typed from evidence (no printed label). */
function inferredName(type: RoomType, areaM2: number): string {
  if (type === 'storage') return areaM2 < 1.5 ? 'Cupboard' : 'Storage';
  return {
    hall: 'Hall',
    balcony: 'Balcony',
    bathroom: 'Bathroom',
    toilet: 'WC',
    bedroom: 'Bedroom',
    living: 'Living Room',
    kitchen: 'Kitchen',
    'kitchen-living': 'Kitchen / Living',
    dining: 'Dining',
    utility: 'Utility',
    unknown: 'Unknown Room',
  }[type];
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

/** "Bedroom", "Bedroom" → "Bedroom 1", "Bedroom 2" (largest first). The printed label is kept. */
function numberDuplicateNames(rooms: AnnotatedRoom[]): void {
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
