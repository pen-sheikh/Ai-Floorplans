import { polygonArea, polygonSelfIntersects } from '../../domain/geometry';
import type { AnnotatedDoor, AnnotatedWindow, FloorPlanAnnotations, PxPoint } from '../annotationTypes';
import type { ReviewProblem } from '../extraction';
import { pxWallGeometry, spanAlongWall, type PxWallGeometry } from '../wallGeometry';

const vec = (p: PxPoint) => ({ x: p.x, z: p.y });
const validPolygon = (poly: readonly PxPoint[]) =>
  poly.length >= 3 &&
  poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
  polygonArea(poly.map(vec)) >= 1 &&
  !polygonSelfIntersects(poly.map(vec));

/**
 * Make automatically extracted annotations structurally valid without throwing work away:
 * one bad element must not invalidate the whole plan. Openings are clamped to their wall,
 * overlapping openings are merged (same kind) or the weaker one is dropped, unusable walls,
 * rooms and outlines are removed — and every repair is reported as a review problem.
 * (Hand-made annotations are validated strictly instead; this is only for extractor output.)
 */
export function sanitizeAnnotations(ann: FloorPlanAnnotations): {
  annotations: FloorPlanAnnotations;
  problems: ReviewProblem[];
} {
  const problems: ReviewProblem[] = [];
  const conflict = (
    message: string,
    elementId?: string,
    impact: ReviewProblem['impact'] = 'geometry-uncertain',
  ) =>
    problems.push({
      severity: 'warning',
      code: 'sanitized',
      category: 'annotation_conflict',
      impact,
      message,
      ...(elementId ? { elementId } : {}),
    });

  // Walls that have no usable geometry.
  const geom = new Map<string, PxWallGeometry>();
  const walls = ann.walls.filter((w) => {
    try {
      geom.set(w.id, pxWallGeometry(w));
      return true;
    } catch {
      conflict(`Wall ${w.id} has no usable geometry and was removed.`, w.id);
      return false;
    }
  });

  // Openings: on an existing wall, inside it, not overlapping each other.
  type Op = (AnnotatedDoor | AnnotatedWindow) & { kindOf: 'door' | 'window'; from: number; to: number };
  const byWall = new Map<string, Op[]>();
  for (const [kindOf, list] of [
    ['door', ann.doors],
    ['window', ann.windows],
  ] as const) {
    for (const o of list) {
      const g = geom.get(o.wallId);
      if (!g) {
        conflict(
          `${kindOf === 'door' ? 'Door' : 'Window'} ${o.id} was on a removed wall and was dropped.`,
          o.id,
        );
        continue;
      }
      const { from, to } = spanAlongWall(g, o.span);
      const cf = Math.max(0, from);
      const ct = Math.min(g.lengthPx, to);
      if (ct - cf < Math.max(2, 0.5 * (to - from))) {
        conflict(
          `${kindOf === 'door' ? 'Door' : 'Window'} ${o.id} lies mostly outside wall ${o.wallId} and was dropped.`,
          o.id,
        );
        continue;
      }
      byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), { ...o, kindOf, from: cf, to: ct }]);
    }
  }
  const doors: AnnotatedDoor[] = [];
  const windows: AnnotatedWindow[] = [];
  for (const [wallId, ops] of byWall) {
    const g = geom.get(wallId)!;
    const kept: Op[] = [];
    for (const o of ops.sort((p, q) => p.from - q.from)) {
      const prev = kept[kept.length - 1];
      if (!prev || o.from >= prev.to - 0.5) {
        kept.push(o);
        continue;
      }
      if (prev.kindOf === o.kindOf && prev.kind === o.kind) {
        prev.to = Math.max(prev.to, o.to);
        prev.confidence = Math.max(prev.confidence ?? 1, o.confidence ?? 1);
        conflict(
          `${o.id} overlapped ${prev.id} on wall ${wallId}; merged into one.`,
          prev.id,
          'semantic-uncertainty',
        );
        continue;
      }
      // Different kinds: a symbol-backed door beats a window beats a plain opening.
      const rank = (x: Op) =>
        (x.kindOf === 'door' ? (x.kind === 'opening' ? 0 : 2) : 1) + (x.confidence ?? 1) * 0.5;
      const [win, lose] = rank(o) > rank(prev) ? [o, prev] : [prev, o];
      if (win === o) kept[kept.length - 1] = o;
      conflict(`${lose.id} overlapped ${win.id} on wall ${wallId} and was dropped.`, win.id);
    }
    for (const o of kept) {
      const at = (t: number) => (g.dominant === 'x' ? g.a.x + g.dir.x * t : g.a.y + g.dir.y * t);
      const span = [at(o.from), at(o.to)].sort((p, q) => p - q).map((v) => +v.toFixed(2)) as [number, number];
      const { kindOf, from: _f, to: _t, ...rest } = o;
      if (kindOf === 'door') doors.push({ ...(rest as AnnotatedDoor), span });
      else windows.push({ ...(rest as AnnotatedWindow), span });
    }
  }

  // Rooms with unusable outlines.
  const rooms = ann.rooms.filter((r) => {
    if (validPolygon(r.polygon)) return true;
    problems.push({
      severity: 'warning',
      code: 'room-dropped',
      category: 'room_boundary',
      impact: 'geometry-uncertain',
      message: `${r.labelSource === 'plan-label' ? `"${r.name}"` : r.id}: its outline is not a valid polygon, so it was left out.`,
      elementId: r.id,
    });
    return false;
  });
  const footprintOk = !ann.footprint.length || validPolygon(ann.footprint);
  if (!footprintOk)
    conflict('The outer outline was not a valid polygon; the floor slab is derived from the rooms instead.');
  const envelopeOk = !ann.internalEnvelope || validPolygon(ann.internalEnvelope);

  const { internalEnvelope, ...rest } = ann;
  return {
    annotations: {
      ...rest,
      ...(internalEnvelope && envelopeOk ? { internalEnvelope } : {}),
      footprint: footprintOk ? ann.footprint : [],
      walls,
      doors,
      windows,
      rooms,
      labels: ann.labels,
      ...(ann.inferredBoundaries ? { inferredBoundaries: ann.inferredBoundaries } : {}),
      fixtures: ann.fixtures.filter((f) => !('polygon' in f) || validPolygon(f.polygon)),
      drawingNotes: ann.drawingNotes,
    },
    problems,
  };
}
