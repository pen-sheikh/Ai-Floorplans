import { defaultRenovation } from '../catalog/renovationPresets';
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
  type ReconstructionNote,
  type Room,
  type ScaleCalibration,
  type Vec2,
  type Wall,
  type WallKind,
  type Window,
} from '../domain/types';
import type {
  AnnotatedSpan,
  AnnotatedWall,
  FloorPlanAnnotation,
  PxDirection,
  PxRect,
} from './annotationTypes';
import { calibrateFromDimensions, DEFAULT_CALIBRATION_OPTIONS, manualCalibration } from './calibrate';

export interface ReconstructOptions {
  /** Override the calibrated scale (px per metre). */
  pixelsPerMeter?: number;
  outlierThreshold?: number;
  /** Override assumed heights. */
  ceilingHeight?: number;
  doorHeight?: number;
}

export class ReconstructionError extends Error {}

const WALL_MATERIAL: Record<WallKind, string> = {
  exterior: 'exterior-render',
  interior: 'paint-white',
  railing: 'railing-glass',
};

/** Long-axis description of an axis-aligned wall rectangle. */
interface WallAxis {
  axis: 'x' | 'y';
  /** Pixel coordinate of the wall start along the long axis. */
  startPx: number;
  endPx: number;
  /** Centreline coordinate on the short axis. */
  centerPx: number;
  thicknessPx: number;
}

export function wallAxis(rect: PxRect): WallAxis {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  if (w <= 0 || h <= 0) throw new ReconstructionError(`Degenerate wall rectangle ${JSON.stringify(rect)}`);
  return w >= h
    ? { axis: 'x', startPx: rect.x0, endPx: rect.x1, centerPx: (rect.y0 + rect.y1) / 2, thicknessPx: h }
    : { axis: 'y', startPx: rect.y0, endPx: rect.y1, centerPx: (rect.x0 + rect.x1) / 2, thicknessPx: w };
}

const DIRECTION: Record<PxDirection, Vec2> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
};

function buildWall(a: AnnotatedWall, t: PlanTransform, height: number): Wall {
  const ax = wallAxis(a.rect);
  const start = ax.axis === 'x' ? { x: ax.startPx, y: ax.centerPx } : { x: ax.centerPx, y: ax.startPx };
  const end = ax.axis === 'x' ? { x: ax.endPx, y: ax.centerPx } : { x: ax.centerPx, y: ax.endPx };
  return {
    id: a.id,
    start: planToWorld(start, t),
    end: planToWorld(end, t),
    thickness: ax.thicknessPx / t.pixelsPerMeter,
    height,
    kind: a.kind,
    materialId: WALL_MATERIAL[a.kind],
    source: 'plan-geometry',
  };
}

function spanOnWall(o: AnnotatedSpan, walls: Map<string, AnnotatedWall>, t: PlanTransform, id: string) {
  const host = walls.get(o.wallId);
  if (!host) throw new ReconstructionError(`${id} references unknown wall ${o.wallId}`);
  const ax = wallAxis(host.rect);
  const [from, to] = o.span[0] <= o.span[1] ? o.span : [o.span[1], o.span[0]];
  if (from < ax.startPx - 0.5 || to > ax.endPx + 0.5) {
    throw new ReconstructionError(`${id} span [${from}, ${to}) lies outside wall ${o.wallId}`);
  }
  return {
    offset: ((from + to) / 2 - ax.startPx) / t.pixelsPerMeter,
    width: (to - from) / t.pixelsPerMeter,
  };
}

/** Normal of an axis-aligned wall built by `buildWall` (n = (−d.z, d.x)). */
const wallNormalForAxis = (axis: 'x' | 'y'): Vec2 => (axis === 'x' ? { x: 0, z: 1 } : { x: -1, z: 0 });

function rectPolygon(r: PxRect, t: PlanTransform): Vec2[] {
  return [
    planToWorld({ x: r.x0, y: r.y0 }, t),
    planToWorld({ x: r.x1, y: r.y0 }, t),
    planToWorld({ x: r.x1, y: r.y1 }, t),
    planToWorld({ x: r.x0, y: r.y1 }, t),
  ];
}

/**
 * Deterministically convert a pixel-space plan annotation into the canonical apartment model.
 * Pure: same annotation + options → same apartment.
 */
export function reconstructApartment(ann: FloorPlanAnnotation, options: ReconstructOptions = {}): Apartment {
  const notes: ReconstructionNote[] = [];
  const assumptions: Assumption[] = [];

  // 1. Scale.
  const calibration: ScaleCalibration =
    options.pixelsPerMeter !== undefined
      ? manualCalibration(options.pixelsPerMeter)
      : calibrateFromDimensions(ann.rooms, {
          ...DEFAULT_CALIBRATION_OPTIONS,
          ...(options.outlierThreshold !== undefined ? { outlierThreshold: options.outlierThreshold } : {}),
        });
  const t: PlanTransform = { originPx: ann.originPx, pixelsPerMeter: calibration.pixelsPerMeter };

  if (calibration.method === 'dimension-labels') {
    const accepted = calibration.samples.filter((s) => s.accepted);
    notes.push({
      code: 'scale-calibrated',
      severity: 'info',
      message: `Scale ${calibration.pixelsPerMeter.toFixed(2)} px/m from ${accepted.length} printed dimensions (max deviation ${(calibration.maxResidual * 100).toFixed(1)} %).`,
    });
    for (const s of calibration.samples.filter((x) => !x.accepted)) {
      notes.push({
        code: 'dimension-label-mismatch',
        severity: 'warning',
        entityId: s.roomId,
        message: `Printed ${s.labelMeters.toFixed(2)} m does not match the drawing (≈${(s.measuredPx / calibration.pixelsPerMeter).toFixed(2)} m at the calibrated scale, ${(s.residual * 100).toFixed(0)} %). Geometry kept as drawn; label excluded from calibration.`,
      });
    }
  } else {
    notes.push({
      code: 'scale-manual',
      severity: 'warning',
      message: 'Scale set manually; dimensions are estimates.',
    });
  }

  const ceilingHeight = options.ceilingHeight ?? ann.defaults.ceilingHeightMeters;
  const doorHeight = options.doorHeight ?? ann.defaults.doorHeightMeters;
  assumptions.push(
    {
      id: 'ceiling-height',
      description: 'Floor-to-ceiling height (not shown on plan)',
      value: ceilingHeight,
      unit: 'm',
      source: 'assumed',
    },
    {
      id: 'door-height',
      description: 'Door height (not shown on plan)',
      value: doorHeight,
      unit: 'm',
      source: 'assumed',
    },
    {
      id: 'railing-height',
      description: 'Balcony balustrade height (not shown on plan)',
      value: ann.defaults.railingHeightMeters,
      unit: 'm',
      source: 'assumed',
    },
  );

  // 2. Walls.
  const annotatedWalls = new Map(ann.walls.map((w) => [w.id, w]));
  const walls: Wall[] = ann.walls.map((a) =>
    buildWall(a, t, a.kind === 'railing' ? ann.defaults.railingHeightMeters : ceilingHeight),
  );
  for (const w of ann.walls.filter((x) => x.note)) {
    notes.push({ code: 'wall-note', severity: 'info', entityId: w.id, message: w.note! });
  }

  // 3. Doors.
  const doors: Door[] = ann.doors.map((d) => {
    const { offset, width } = spanOnWall(d, annotatedWalls, t, d.id);
    const ax = wallAxis(annotatedWalls.get(d.wallId)!.rect);
    const n = wallNormalForAxis(ax.axis);
    const sw = DIRECTION[d.swing];
    const side = sw.x * n.x + sw.z * n.z;
    if (side === 0 && d.kind !== 'opening') {
      throw new ReconstructionError(`${d.id}: swing '${d.swing}' is parallel to its wall`);
    }
    if (d.note) notes.push({ code: 'door-note', severity: 'info', entityId: d.id, message: d.note });
    return {
      id: d.id,
      wallId: d.wallId,
      offset,
      width,
      height: d.heightMeters ?? doorHeight,
      kind: d.kind,
      hinge: d.hinge === 'min' ? 'start' : 'end',
      swingSide: side >= 0 ? 1 : -1,
      materialId: 'wood-white',
      connects: [null, null],
      source: 'plan-geometry',
      ...(d.label ? { note: d.label } : {}),
    };
  });

  // 4. Windows.
  const windows: Window[] = ann.windows.map((w) => {
    const { offset, width } = spanOnWall(w, annotatedWalls, t, w.id);
    return {
      id: w.id,
      wallId: w.wallId,
      offset,
      width,
      height: w.headHeightMeters - w.sillHeightMeters,
      sillHeight: w.sillHeightMeters,
      kind: w.kind,
      materialId: 'upvc-white',
      source: 'plan-geometry',
    };
  });
  const sills = [...new Set(ann.windows.map((w) => `${w.sillHeightMeters}–${w.headHeightMeters} m`))];
  assumptions.push({
    id: 'window-heights',
    description: 'Window sill–head heights (not shown on plan)',
    value: sills.join(', '),
    source: 'assumed',
  });

  // 5. Rooms.
  const rooms: Room[] = ann.rooms.map((r) => {
    if (r.labelSource !== 'plan-label') {
      notes.push({
        code: 'room-label-inferred',
        severity: 'info',
        entityId: r.id,
        message: r.note ?? `"${r.name}" is not labelled on the plan; name inferred from the drawing.`,
      });
    }
    const unknown = r.labelSource === 'unknown';
    return {
      id: r.id,
      name: unknown ? 'Unknown Room' : r.name,
      type: unknown ? 'unknown' : r.type,
      labelSource: r.labelSource === 'plan-label' ? 'plan-label' : 'inferred',
      ...(r.label ? { planLabel: r.label } : {}),
      polygon: r.polygon.map((p) => planToWorld(p, t)),
      ceilingHeight,
      exterior: r.exterior ?? false,
      wallIds: [],
      doorIds: [],
      windowIds: [],
      renovation: defaultRenovation(unknown ? 'unknown' : r.type),
    };
  });

  // 6. Fixtures.
  const fixtures: Fixture[] = ann.fixtures.map((f) => {
    const footprint = rectPolygon(f.rect, t);
    const c = polygonCentroid(footprint);
    const room = rooms.find((r) => pointStrictlyInPolygon(c, r.polygon));
    if (f.uncertain) {
      notes.push({
        code: 'fixture-uncertain',
        severity: 'info',
        entityId: f.id,
        message: f.note ?? `${f.label}: nature uncertain.`,
      });
    }
    return {
      id: f.id,
      roomId: room?.id ?? null,
      kind: f.kind,
      label: f.label,
      footprint,
      height: f.heightMeters,
      elevation: f.elevationMeters ?? 0,
      materialId: f.materialId,
      source: f.uncertain ? 'inferred' : 'plan-geometry',
      ...(f.note ? { note: f.note } : {}),
    };
  });
  assumptions.push({
    id: 'fixture-heights',
    description: 'Fixture heights (bath, WC, basin, counters) are typical values, not from the plan',
    value: 'typical',
    source: 'assumed',
  });

  for (const n of ann.drawingNotes)
    notes.push({ code: `drawing-${n.id}`, severity: 'info', message: n.message });

  // 7. Area cross-check against the printed total.
  if (ann.reportedArea) {
    const envelope = ann.internalEnvelope.map((p) => planToWorld(p, t));
    const measured = polygonArea(envelope);
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
    const v = normalize({
      x: ann.compass.northTip.x - ann.compass.center.x,
      z: ann.compass.northTip.y - ann.compass.center.y,
    });
    north = { ...v, source: 'plan-geometry' };
  }

  const floor: Floor = deriveTopology({
    id: `${ann.id}-floor-${ann.level}`,
    name: ann.floorLabel ?? `Level ${ann.level}`,
    level: ann.level,
    elevation: 0,
    height: ceilingHeight,
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
