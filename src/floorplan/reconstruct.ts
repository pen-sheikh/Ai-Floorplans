import { defaultRenovation as catalogDefaultRenovation } from '../catalog/renovationPresets';
import { planToWorld, type PlanTransform } from '../domain/coordinates';
import { normalize, polygonArea, pointStrictlyInPolygon, polygonCentroid } from '../domain/geometry';
import { deriveTopology } from '../domain/topology';
import {
  SCHEMA_VERSION,
  type Apartment,
  type Assumption,
  type Door,
  type Fixture,
  type Floor,
  type Provenance,
  type ReconstructionNote,
  type Room,
  type RoomRenovation,
  type RoomType,
  type ScaleCalibration,
  type Vec2,
  type Wall,
  type WallKind,
  type Window,
} from '../domain/types';
import type { AnnotatedFixture, FloorPlanAnnotations, PxDirection, PxPoint } from './annotationTypes';
import { calibrateAnnotations, DEFAULT_CALIBRATION_OPTIONS, manualCalibration } from './calibrate';
import { validateAnnotations, type AnnotationIssue } from './validateAnnotations';
import { pxWallGeometry, spanAlongWall, type PxWallGeometry } from './wallGeometry';

export { wallAxis } from './wallGeometry';

export interface ReconstructOptions {
  /** Override the calibrated scale (px per metre). */
  pixelsPerMeter?: number;
  outlierThreshold?: number;
  /** Override assumed heights. */
  ceilingHeight?: number;
  doorHeight?: number;
  /** Starting finishes per room type (configuration, not plan data). */
  defaultRenovation?: (type: RoomType) => RoomRenovation;
}

export class ReconstructionError extends Error {
  constructor(
    message: string,
    readonly issues: AnnotationIssue[] = [],
  ) {
    super(message);
  }
}

const WALL_MATERIAL: Record<WallKind, string> = {
  exterior: 'exterior-render',
  interior: 'paint-white',
  railing: 'railing-glass',
};

const DIRECTION: Record<PxDirection, PxPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function fixtureOutline(f: AnnotatedFixture): PxPoint[] {
  if ('polygon' in f) return f.polygon;
  const r = f.rect;
  return [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ];
}

const confidence = (c: number | undefined) => (c === undefined ? {} : { confidence: c });

/**
 * Deterministically convert floor-plan annotations into the canonical apartment model.
 *
 * Generic: works for any annotations (orthogonal or angled walls, any simple room polygons)
 * whether they were drawn by a person or produced by an extractor. Pure: same annotations +
 * options → same apartment. Throws `ReconstructionError` listing every annotation error.
 */
export function reconstructApartment(ann: FloorPlanAnnotations, options: ReconstructOptions = {}): Apartment {
  const issues = validateAnnotations(ann);
  const errors = issues.filter((i) => i.severity === 'error');
  // A manual scale override makes "no scale" errors irrelevant.
  const blocking =
    options.pixelsPerMeter !== undefined ? errors.filter((e) => e.code !== 'no-scale') : errors;
  if (blocking.length) {
    throw new ReconstructionError(
      `Annotations are invalid: ${blocking.map((e) => e.message).join(' ')}`,
      blocking,
    );
  }

  const notes: ReconstructionNote[] = issues
    .filter((i) => i.severity === 'warning')
    .map((i) => ({
      code: `annotation-${i.code}`,
      severity: 'warning',
      message: i.message,
      ...(i.elementId ? { entityId: i.elementId } : {}),
    }));
  const assumptions: Assumption[] = [];
  const renovationFor = options.defaultRenovation ?? catalogDefaultRenovation;
  // Geometry provenance: drawn-and-measured vs detected by software.
  const geometry: Provenance = ann.source.method === 'automatic' ? 'detected' : 'plan-geometry';

  // 1. Scale.
  const calibration: ScaleCalibration =
    options.pixelsPerMeter !== undefined
      ? manualCalibration(options.pixelsPerMeter)
      : calibrateAnnotations(ann, {
          ...DEFAULT_CALIBRATION_OPTIONS,
          ...(options.outlierThreshold !== undefined ? { outlierThreshold: options.outlierThreshold } : {}),
        });
  const t: PlanTransform = { originPx: ann.originPx, pixelsPerMeter: calibration.pixelsPerMeter };
  const px = (v: number) => v / t.pixelsPerMeter;

  if (calibration.method === 'dimension-labels' || calibration.method === 'reference') {
    const accepted = calibration.samples.filter((s) => s.accepted);
    notes.push({
      code: 'scale-calibrated',
      severity: 'info',
      message: `Scale ${calibration.pixelsPerMeter.toFixed(2)} px/m from ${accepted.length} ${calibration.method === 'reference' ? 'reference measurement(s)' : 'printed dimension(s)'} (max deviation ${(calibration.maxResidual * 100).toFixed(1)} %, ${calibration.confidence} confidence).`,
    });
    for (const s of calibration.samples.filter((x) => !x.accepted)) {
      notes.push({
        code: 'dimension-label-mismatch',
        severity: 'warning',
        entityId: s.roomId ?? s.referenceId,
        message: `Printed ${s.labelMeters.toFixed(2)} m does not match the drawing (≈${px(s.measuredPx).toFixed(2)} m at the calibrated scale, ${(s.residual * 100).toFixed(0)} %). Geometry kept as drawn; label excluded from calibration.`,
      });
    }
  } else if (calibration.method === 'estimated') {
    notes.push({
      code: 'scale-estimated',
      severity: 'warning',
      message: `Scale ESTIMATED from ${calibration.basis ?? 'typical sizes'} (${calibration.pixelsPerMeter.toFixed(1)} px/m). All dimensions are approximate; enter a known measurement to calibrate.`,
    });
  } else {
    notes.push({
      code: 'scale-manual',
      severity: 'warning',
      message: 'Scale set manually; all dimensions are estimates.',
    });
  }

  const ceilingHeight = options.ceilingHeight ?? ann.defaults.ceilingHeightMeters;
  const doorHeight = options.doorHeight ?? ann.defaults.doorHeightMeters;
  const assume = (id: string, description: string, value: number | string, unit?: string) =>
    assumptions.push({ id, description, value, ...(unit ? { unit } : {}), source: 'assumed' });
  assume('ceiling-height', 'Floor-to-ceiling height (not shown on plan)', ceilingHeight, 'm');
  assume('door-height', 'Door height (not shown on plan)', doorHeight, 'm');
  if (ann.walls.some((w) => w.kind === 'railing')) {
    assume('railing-height', 'Balustrade height (not shown on plan)', ann.defaults.railingHeightMeters, 'm');
  }

  // 2. Walls.
  const pxWalls = new Map<string, PxWallGeometry>(ann.walls.map((w) => [w.id, pxWallGeometry(w)]));
  const walls: Wall[] = ann.walls.map((a) => {
    const g = pxWalls.get(a.id)!;
    return {
      id: a.id,
      start: planToWorld(g.a, t),
      end: planToWorld(g.b, t),
      thickness: px(g.thicknessPx),
      height: a.kind === 'railing' ? ann.defaults.railingHeightMeters : ceilingHeight,
      kind: a.kind,
      materialId: WALL_MATERIAL[a.kind],
      sources: { geometry, height: 'assumed' },
      ...confidence(a.confidence),
    };
  });
  for (const w of ann.walls.filter((x) => x.note))
    notes.push({ code: 'wall-note', severity: 'info', entityId: w.id, message: w.note! });

  const opening = (wallId: string, span: [number, number]) => {
    const { from, to } = spanAlongWall(pxWalls.get(wallId)!, span);
    return { offset: px((from + to) / 2), width: px(to - from) };
  };

  // 3. Doors. The swing side is the sign of the drawn swing direction on the wall normal.
  const doors: Door[] = ann.doors.map((d) => {
    const g = pxWalls.get(d.wallId)!;
    const sw = DIRECTION[d.swing];
    const side = sw.x * -g.dir.y + sw.y * g.dir.x;
    if (d.note) notes.push({ code: 'door-note', severity: 'info', entityId: d.id, message: d.note });
    return {
      id: d.id,
      wallId: d.wallId,
      ...opening(d.wallId, d.span),
      height: d.heightMeters ?? doorHeight,
      kind: d.kind,
      hinge: d.hinge === 'min' ? 'start' : 'end',
      swingSide: side >= 0 ? 1 : -1,
      materialId: 'wood-white',
      connects: [null, null],
      sources: {
        geometry,
        height: d.heightFromPlan ? 'plan-label' : 'assumed',
        swing: d.kind === 'opening' ? 'inferred' : geometry,
      },
      ...confidence(d.confidence),
      ...(d.label ? { note: d.label } : {}),
    };
  });

  // 4. Windows.
  const windows: Window[] = ann.windows.map((w) => {
    const sill = w.sillHeightMeters ?? ann.defaults.windowSillMeters;
    const head = w.headHeightMeters ?? ann.defaults.windowHeadMeters;
    const heights: Provenance = w.heightsFromPlan ? 'plan-label' : 'assumed';
    return {
      id: w.id,
      wallId: w.wallId,
      ...opening(w.wallId, w.span),
      height: head - sill,
      sillHeight: sill,
      kind: w.kind,
      materialId: 'upvc-white',
      sources: { geometry, sillHeight: heights, height: heights },
      ...confidence(w.confidence),
    };
  });
  const assumedWindows = ann.windows.filter((w) => !w.heightsFromPlan);
  if (assumedWindows.length) {
    const ranges = new Set(
      assumedWindows.map(
        (w) =>
          `${w.sillHeightMeters ?? ann.defaults.windowSillMeters}–${w.headHeightMeters ?? ann.defaults.windowHeadMeters} m`,
      ),
    );
    assume('window-heights', 'Window sill–head heights (not shown on plan)', [...ranges].join(', '));
  }

  // 5. Rooms. Geometry and meaning are kept apart: a room with a valid outline is a room, even
  //    when its name or type is unknown. Automatically read names are "ocr", never "printed".
  const rooms: Room[] = ann.rooms.map((r) => {
    const unknown = r.labelSource === 'unknown';
    if (r.labelSource !== 'plan-label') {
      notes.push({
        code: 'room-label-inferred',
        severity: 'info',
        entityId: r.id,
        message:
          r.note ??
          (unknown
            ? `${r.id} has no readable label; kept as "Unknown Room".`
            : `"${r.name}" is not labelled on the plan; name inferred from the drawing.`),
      });
    }
    const automatic = ann.source.method === 'automatic';
    const labelSource: Provenance =
      r.labelSource === 'plan-label' ? (automatic ? 'ocr' : 'plan-label') : 'inferred';
    const typeSource: Provenance | undefined =
      unknown || r.type === 'unknown' ? undefined : r.labelSource === 'plan-label' ? labelSource : 'inferred';
    return {
      id: r.id,
      name: unknown ? 'Unknown Room' : r.name,
      type: unknown ? 'unknown' : r.type,
      labelSource,
      ...(r.label ? { planLabel: r.label } : {}),
      polygon: r.polygon.map((p) => planToWorld(p, t)),
      ceilingHeight,
      exterior: r.exterior ?? false,
      sources: {
        geometry,
        ceilingHeight: 'assumed',
        ...(automatic && !unknown ? { name: labelSource } : {}),
        ...(automatic && typeSource ? { type: typeSource } : {}),
      },
      ...confidence(r.confidence),
      ...(r.geometryConfidence !== undefined ? { geometryConfidence: r.geometryConfidence } : {}),
      ...(r.labelConfidence !== undefined ? { labelConfidence: r.labelConfidence } : {}),
      ...(r.classificationConfidence !== undefined
        ? { classificationConfidence: r.classificationConfidence }
        : {}),
      ...(r.classification ? { classification: r.classification } : {}),
      wallIds: [],
      doorIds: [],
      windowIds: [],
      renovation: renovationFor(unknown ? 'unknown' : r.type),
    };
  });

  // 6. Fixtures.
  const fixtures: Fixture[] = ann.fixtures.map((f) => {
    const footprint = fixtureOutline(f).map((p) => planToWorld(p, t));
    const c = polygonCentroid(footprint);
    const room = rooms.find((r) => pointStrictlyInPolygon(c, r.polygon));
    if (f.uncertain)
      notes.push({
        code: 'fixture-uncertain',
        severity: 'info',
        entityId: f.id,
        message: f.note ?? `${f.label}: nature uncertain.`,
      });
    return {
      id: f.id,
      roomId: room?.id ?? null,
      kind: f.kind,
      label: f.label,
      footprint,
      height: f.heightMeters,
      elevation: f.elevationMeters ?? 0,
      materialId: f.materialId,
      sources: { footprint: f.uncertain ? 'inferred' : geometry, height: 'assumed' },
      ...confidence(f.confidence),
      ...(f.note ? { note: f.note } : {}),
    };
  });
  if (fixtures.length)
    assume(
      'fixture-heights',
      'Fixture heights (baths, WCs, counters…) are typical values, not from the plan',
      'typical',
    );

  for (const n of ann.drawingNotes)
    notes.push({ code: `drawing-${n.id}`, severity: 'info', message: n.message });

  // 7. Area cross-check against the printed total.
  if (ann.reportedArea && ann.internalEnvelope) {
    const measured = polygonArea(ann.internalEnvelope.map((p) => planToWorld(p, t)));
    const diff = (measured - ann.reportedArea.m2) / ann.reportedArea.m2;
    notes.push({
      code: 'area-cross-check',
      severity: Math.abs(diff) <= 0.05 ? 'info' : 'warning',
      message: `Internal envelope ≈${measured.toFixed(1)} m² vs ${ann.reportedArea.m2} m² printed (${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)} %).`,
    });
  }

  // 8. North.
  let north: Apartment['coordinateSystem']['north'];
  if (ann.compass) {
    const v: Vec2 = normalize({
      x: ann.compass.northTip.x - ann.compass.center.x,
      z: ann.compass.northTip.y - ann.compass.center.y,
    });
    north = { ...v, source: geometry };
  }

  const floor: Floor = deriveTopology({
    id: `${ann.id}-floor-${ann.level}`,
    name: ann.floorLabel ?? `Level ${ann.level}`,
    level: ann.level,
    elevation: 0,
    height: ceilingHeight,
    heightSource: 'assumed',
    footprint: ann.footprint.map((p) => planToWorld(p, t)),
    rooms,
    walls,
    doors,
    windows,
    stairs: [],
    fixtures,
    furniture: [],
  });

  for (const d of floor.doors) {
    if (d.connects.every((c) => c === null)) {
      notes.push({
        code: 'door-unconnected',
        severity: 'warning',
        entityId: d.id,
        message: `${d.id} does not connect any room.`,
      });
    }
  }
  for (const r of floor.rooms.filter((x) => x.doorIds.length === 0)) {
    notes.push({
      code: 'room-no-door',
      severity: 'warning',
      entityId: r.id,
      message: `${r.name} has no door or opening.`,
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: ann.id,
    metadata: {
      name: ann.name,
      ...(ann.building ? { building: ann.building } : {}),
      ...(ann.floorLabel ? { floorLabel: ann.floorLabel } : {}),
      ...(ann.reportedArea
        ? { reportedAreaM2: { value: ann.reportedArea.m2, note: ann.reportedArea.note } }
        : {}),
      annotationSource: {
        method: ann.source.method,
        ...(ann.source.producer ? { producer: ann.source.producer } : {}),
        ...(ann.source.confidence !== undefined ? { confidence: ann.source.confidence } : {}),
      },
      assumptions,
      notes,
    },
    coordinateSystem: {
      units: 'meters',
      up: 'Y',
      plan: { image: ann.image, originPx: ann.originPx, calibration },
      ...(north ? { north } : {}),
    },
    floors: [floor],
  };
}
