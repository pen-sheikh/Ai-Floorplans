import { polygonArea, polygonSelfIntersects } from '../domain/geometry';
import type { IssueSeverity, Vec2 } from '../domain/types';
import {
  ANNOTATION_FORMAT_VERSION,
  dimensionPx,
  type AnnotatedDimension,
  type FloorPlanAnnotations,
  type PxPoint,
} from './annotationTypes';
import { pxWallGeometry, spanAlongWall, WallGeometryError, type PxWallGeometry } from './wallGeometry';

export interface AnnotationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  elementId?: string;
}

const asVec = (p: PxPoint): Vec2 => ({ x: p.x, z: p.y });
const finite = (p: PxPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Structural checks on annotations before reconstruction. Automatic extractors will produce
 * imperfect output; this reports every problem at once (with element ids) instead of failing
 * on the first one, so an extractor or a human can fix them.
 */
export function validateAnnotations(ann: FloorPlanAnnotations): AnnotationIssue[] {
  const issues: AnnotationIssue[] = [];
  const err = (code: string, message: string, elementId?: string) =>
    issues.push({ severity: 'error', code, message, ...(elementId ? { elementId } : {}) });
  const warn = (code: string, message: string, elementId?: string) =>
    issues.push({ severity: 'warning', code, message, ...(elementId ? { elementId } : {}) });

  if (ann.formatVersion !== ANNOTATION_FORMAT_VERSION) {
    err('format-version', `Unsupported annotation format v${String(ann.formatVersion)}.`);
  }
  if (!(ann.image.widthPx > 0 && ann.image.heightPx > 0)) err('image-size', 'Image size must be positive.');
  if (!finite(ann.originPx)) err('origin', 'Origin must be finite.');

  const ids = new Set<string>();
  const all = [
    ...ann.walls,
    ...ann.doors,
    ...ann.windows,
    ...ann.rooms,
    ...ann.fixtures,
    ...(ann.labels ?? []),
  ];
  for (const el of all) {
    if (ids.has(el.id)) err('duplicate-id', `Duplicate annotation id "${el.id}".`, el.id);
    ids.add(el.id);
    if (el.confidence !== undefined && !(el.confidence >= 0 && el.confidence <= 1)) {
      err('confidence-range', `${el.id}: confidence must be within [0, 1].`, el.id);
    }
  }

  // Walls.
  const walls = new Map<string, PxWallGeometry>();
  for (const w of ann.walls) {
    try {
      walls.set(w.id, pxWallGeometry(w));
    } catch (e) {
      err('wall-geometry', e instanceof WallGeometryError ? e.message : String(e), w.id);
    }
  }

  // Openings: on an existing wall, inside it, non-empty, not overlapping each other.
  const used = new Map<string, { id: string; from: number; to: number }[]>();
  for (const o of [...ann.doors, ...ann.windows]) {
    const g = walls.get(o.wallId);
    if (!g) {
      err('opening-wall', `${o.id}: references unknown wall "${o.wallId}".`, o.id);
      continue;
    }
    const { from, to } = spanAlongWall(g, o.span);
    if (!(to - from > 0)) err('opening-empty', `${o.id}: span is empty.`, o.id);
    if (from < -0.5 || to > g.lengthPx + 0.5)
      err('opening-outside-wall', `${o.id}: span lies outside wall ${o.wallId}.`, o.id);
    for (const other of used.get(o.wallId) ?? []) {
      if (Math.min(to, other.to) - Math.max(from, other.from) > 0.5) {
        err('opening-overlap', `${o.id} overlaps ${other.id} on wall ${o.wallId}.`, o.id);
      }
    }
    used.set(o.wallId, [...(used.get(o.wallId) ?? []), { id: o.id, from, to }]);
  }
  for (const d of ann.doors) {
    const g = walls.get(d.wallId);
    if (!g || d.kind === 'opening') continue;
    const s = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[
      d.swing
    ];
    // Swing must point across the wall, not along it.
    if (Math.abs(s.x * -g.dir.y + s.y * g.dir.x) < 0.3)
      err('door-swing', `${d.id}: swing "${d.swing}" runs along its wall.`, d.id);
  }
  for (const w of ann.windows) {
    const sill = w.sillHeightMeters ?? ann.defaults.windowSillMeters;
    const head = w.headHeightMeters ?? ann.defaults.windowHeadMeters;
    if (!(head > sill && sill >= 0)) err('window-heights', `${w.id}: head must be above sill.`, w.id);
  }

  // Rooms and fixtures.
  const checkPolygon = (id: string, poly: PxPoint[], what: string) => {
    if (poly.length < 3 || !poly.every(finite))
      return err(`${what}-polygon`, `${id}: polygon needs ≥ 3 finite points.`, id);
    const v = poly.map(asVec);
    if (polygonArea(v) < 1) err(`${what}-area`, `${id}: polygon has no area.`, id);
    if (polygonSelfIntersects(v)) err(`${what}-self-intersection`, `${id}: polygon self-intersects.`, id);
    if (poly.some((p) => p.x < 0 || p.y < 0 || p.x > ann.image.widthPx || p.y > ann.image.heightPx)) {
      warn(`${what}-outside-image`, `${id}: polygon extends beyond the image.`, id);
    }
  };
  for (const r of ann.rooms) {
    checkPolygon(r.id, r.polygon, 'room');
    if (r.labelId && !ann.labels?.some((l) => l.id === r.labelId))
      err('room-label-ref', `${r.id}: unknown label "${r.labelId}".`, r.id);
  }
  for (const f of ann.fixtures) {
    if ('rect' in f) {
      if (!(f.rect.x1 > f.rect.x0 && f.rect.y1 > f.rect.y0))
        err('fixture-rect', `${f.id}: empty rectangle.`, f.id);
    } else checkPolygon(f.id, f.polygon, 'fixture');
    if (!(f.heightMeters > 0)) err('fixture-height', `${f.id}: height must be positive.`, f.id);
  }
  if (ann.footprint.length) checkPolygon('footprint', ann.footprint, 'footprint');
  if (ann.internalEnvelope) checkPolygon('internalEnvelope', ann.internalEnvelope, 'envelope');

  // Calibration.
  const refs: AnnotatedDimension[] = [
    ...ann.rooms.flatMap((r) => r.dimensions ?? []),
    ...(ann.calibration?.references ?? []),
  ];
  for (const d of refs) {
    if (!(d.meters > 0) || !(dimensionPx(d) > 0))
      err('dimension', `Dimension ${d.id ?? d.text ?? ''} has no length.`, d.id);
  }
  const manual = ann.calibration?.manualPixelsPerMeter;
  const estimated = ann.calibration?.estimatedPixelsPerMeter;
  if (estimated && !(estimated.value > 0)) err('estimated-scale', 'Estimated scale must be positive.');
  if (manual !== undefined && !(manual > 0)) err('manual-scale', 'Manual scale must be positive.');
  if (!refs.length && manual === undefined && estimated) {
    warn('estimated-scale', `Scale is estimated (${estimated.basis}); real-world sizes are approximate.`);
  } else if (!refs.length && manual === undefined) {
    err('no-scale', 'No printed dimensions and no manual scale: real-world size cannot be determined.');
  } else if (refs.length === 1 && manual === undefined) {
    warn('single-scale-reference', 'Scale comes from a single dimension; it cannot be cross-checked.');
  }

  const h = ann.defaults;
  for (const [k, v] of Object.entries(h))
    if (!(v > 0) && k !== 'windowSillMeters') err('default-height', `Default ${k} must be positive.`);
  return issues;
}
