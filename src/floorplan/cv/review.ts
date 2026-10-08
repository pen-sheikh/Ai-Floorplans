import type { AnnotatedRoom, FloorPlanAnnotations } from '../annotationTypes';
import type {
  ComponentAssessment,
  DocumentCheck,
  ExtractionCalibrationReport,
  ExtractionComponent,
  ExtractionIssueCategory,
  ExtractionReview,
  ReviewProblem,
} from '../extraction';
import { validateAnnotations, type AnnotationIssue } from '../validateAnnotations';

export interface ReviewThresholds {
  wall: number;
  door: number;
  window: number;
  room: number;
  swing: number;
  geometry: number;
}

export const DEFAULT_REVIEW_THRESHOLDS: ReviewThresholds = {
  wall: 0.6,
  door: 0.6,
  window: 0.6,
  room: 0.6,
  swing: 0.5,
  geometry: 0.7,
};

export interface ReviewContext {
  unplacedLabels?: string[];
  refinedDimensions?: string[];
  /** Free-text warnings from extraction stages (categorised as structural ambiguity). */
  warnings?: string[];
  /** Specific problems already found by extraction stages (sanitising, boundaries, …). */
  stageProblems?: ReviewProblem[];
  document?: DocumentCheck;
}

const pct = (c: number | undefined) => `${Math.round((c ?? 1) * 100)} %`;

/** "Room 4" for an unnamed room, its printed name otherwise. */
export function roomTitle(r: AnnotatedRoom, rooms: readonly AnnotatedRoom[]): string {
  if (r.labelSource === 'plan-label') return `"${r.name}"`;
  return `Room ${rooms.indexOf(r) + 1}`;
}

/** Category of a structural validation issue, by the element it concerns. */
function categoryOf(issue: AnnotationIssue): ExtractionIssueCategory {
  const c = issue.code;
  if (c.includes('scale') || c.startsWith('dimension')) return 'scale';
  if (c.startsWith('room') || c.startsWith('footprint') || c.startsWith('envelope')) return 'room_boundary';
  if (c.startsWith('wall')) return 'wall_detection';
  if (c.startsWith('door')) return 'door_detection';
  if (c.startsWith('window')) return 'window_detection';
  return 'annotation_conflict';
}

/**
 * Decide how extracted annotations can be used. Geometry and meaning are judged separately:
 * only problems that make a valid 3D model impossible fail the extraction; uncertain geometry
 * needs a person to confirm; uncertain names, types or symbols are warnings that do not block.
 * Every problem names the element and carries a machine-readable category.
 */
export function assessExtraction(
  ann: FloorPlanAnnotations,
  cal: ExtractionCalibrationReport | undefined,
  context: ReviewContext = {},
  thresholds: ReviewThresholds = DEFAULT_REVIEW_THRESHOLDS,
): ExtractionReview {
  const problems: ReviewProblem[] = [...(context.stageProblems ?? [])];
  const add = (p: ReviewProblem) => problems.push(p);
  const mentioned = (id: string) => problems.some((p) => p.elementId === id || p.elementIds?.includes(id));

  // ── Structural validity ──────────────────────────────────────────────────────────
  for (const issue of validateAnnotations(ann)) {
    // Scale is reported once, from the calibration below.
    if (issue.code === 'estimated-scale') continue;
    const single = issue.code === 'single-scale-reference';
    add({
      severity: issue.severity === 'error' ? 'error' : 'warning',
      code: `annotation-${issue.code}`,
      category: categoryOf(issue),
      impact:
        issue.severity === 'error'
          ? 'geometry-failure'
          : single
            ? 'semantic-uncertainty'
            : 'geometry-uncertain',
      message: issue.message,
      ...(issue.elementId ? { elementId: issue.elementId } : {}),
    });
  }
  if (!ann.rooms.length) {
    add({
      severity: 'error',
      code: 'no-rooms',
      category: 'room_detection',
      impact: 'geometry-failure',
      message: 'No enclosed room could be found, so no floor or 3D model can be built.',
    });
  }

  // ── Walls ────────────────────────────────────────────────────────────────────────
  const weakWalls = ann.walls.filter((w) => (w.confidence ?? 1) < thresholds.wall);
  if (weakWalls.length) {
    add({
      severity: 'warning',
      code: 'low-confidence-walls',
      category: 'wall_detection',
      impact: 'geometry-uncertain',
      message: `${weakWalls.length} wall${weakWalls.length > 1 ? 's have' : ' has'} low confidence (${weakWalls
        .slice(0, 6)
        .map((w) => `${w.id} ${pct(w.confidence)}`)
        .join(', ')}${weakWalls.length > 6 ? ', …' : ''}).`,
      elementIds: weakWalls.map((w) => w.id),
    });
  }

  // ── Rooms: geometry, label and type judged separately ─────────────────────────────
  for (const r of ann.rooms) {
    const title = roomTitle(r, ann.rooms);
    if ((r.geometryConfidence ?? 1) < thresholds.geometry && !mentioned(r.id)) {
      add({
        severity: 'warning',
        code: 'uncertain-room-boundary',
        category: 'room_boundary',
        impact: 'geometry-uncertain',
        message: `${title} has an uncertain boundary (${pct(r.geometryConfidence)}).`,
        elementId: r.id,
      });
    }
    if (r.labelSource === 'unknown') {
      const guess = r.classification?.suggestedType;
      add({
        severity: 'warning',
        code: 'unnamed-room',
        category: 'room_label',
        impact: 'semantic-uncertainty',
        message: `${title} has valid geometry but no readable label; kept as "Unknown Room"${guess ? ` (it may be a ${guess}, not assumed)` : ''}.`,
        elementId: r.id,
      });
    } else if (r.labelSource === 'inferred') {
      add({
        severity: 'info',
        code: 'inferred-room',
        category: 'room_classification',
        impact: 'semantic-uncertainty',
        message: `${title} has no label; classified as "${r.name}" (${r.classification?.evidence.join('; ') ?? 'inferred'}, ${pct(r.classificationConfidence ?? r.confidence)}).`,
        elementId: r.id,
      });
    } else {
      const lc = r.labelConfidence ?? r.confidence;
      if ((lc ?? 1) < thresholds.room) {
        add({
          severity: 'warning',
          code: 'uncertain-room-label',
          category: 'room_label',
          impact: 'semantic-uncertainty',
          message: `${title}: the label "${r.label?.text ?? r.name}" was read with low confidence (${pct(lc)}).`,
          elementId: r.id,
        });
      }
      if (r.type === 'unknown') {
        add({
          severity: 'warning',
          code: 'unclassified-label',
          category: 'room_classification',
          impact: 'semantic-uncertainty',
          message: `${title}: the label "${r.label?.text ?? r.name}" does not name a known room type; type left unknown.`,
          elementId: r.id,
        });
      }
    }
  }
  for (const t of context.unplacedLabels ?? []) {
    add({
      severity: 'warning',
      code: 'label-outside-rooms',
      category: 'room_detection',
      impact: 'geometry-uncertain',
      message: `Label "${t}" is not inside any enclosed room: that space was not found (its boundary may be open or drawn only as thin lines).`,
    });
  }

  // ── Openings ─────────────────────────────────────────────────────────────────────
  for (const d of ann.doors) {
    if (d.kind === 'opening') {
      add({
        severity: 'warning',
        code: 'unclassified-opening',
        category: 'door_detection',
        impact: 'semantic-uncertainty',
        message: `Opening ${d.id} has no door symbol: it may be a doorway or a door that could not be recognised (${pct(d.confidence)}).`,
        elementId: d.id,
      });
      continue;
    }
    if ((d.confidence ?? 1) < thresholds.door) {
      add({
        severity: 'warning',
        code: 'possible-door',
        category: 'door_detection',
        impact: 'semantic-uncertainty',
        message: `Door ${d.id} is uncertain (${pct(d.confidence)}).`,
        elementId: d.id,
      });
    } else if ((d.swingConfidence ?? 1) < thresholds.swing) {
      add({
        severity: 'warning',
        code: 'uncertain-swing',
        category: 'door_detection',
        impact: 'semantic-uncertainty',
        message: `Door ${d.id} has an uncertain opening direction (${pct(d.swingConfidence)}).`,
        elementId: d.id,
      });
    }
  }
  for (const w of ann.windows) {
    if ((w.confidence ?? 1) < thresholds.window) {
      add({
        severity: 'warning',
        code: 'possible-window',
        category: 'window_detection',
        impact: 'semantic-uncertainty',
        message: `Window ${w.id} is uncertain (${pct(w.confidence)}).`,
        elementId: w.id,
      });
    }
  }

  // ── Scale ────────────────────────────────────────────────────────────────────────
  for (const t of context.refinedDimensions ?? []) {
    add({
      severity: 'info',
      code: 'dimension-reread',
      category: 'scale',
      impact: 'semantic-uncertainty',
      message: `Dimension "${t}" was unclear and was read a second time; check it.`,
    });
  }
  if (cal) {
    if (cal.strategy === 'estimated') {
      add({
        severity: 'warning',
        code: 'scale-estimated',
        category: 'scale',
        impact: 'geometry-uncertain',
        message: `Scale was estimated from ${cal.basis}: real-world sizes are approximate. Enter a known measurement to calibrate.`,
      });
    } else if (cal.strategy === 'manual') {
      add({
        severity: 'info',
        code: 'scale-manual',
        category: 'scale',
        impact: 'missing-optional',
        message: 'Scale was entered manually.',
      });
    }
    if (cal.samplesRejected) {
      add({
        severity: 'warning',
        code: 'dimension-mismatch',
        category: 'scale',
        impact: 'semantic-uncertainty',
        message: `${cal.samplesRejected} printed dimension${cal.samplesRejected > 1 ? 's disagree' : ' disagrees'} with the drawing and ${cal.samplesRejected > 1 ? 'were' : 'was'} not used for scale.`,
      });
    }
  }

  // ── Optional information and stage warnings ──────────────────────────────────────
  if (!ann.fixtures.length) {
    add({
      severity: 'info',
      code: 'no-fixtures',
      category: 'unsupported_symbol',
      impact: 'missing-optional',
      message:
        'Fixed fittings (kitchen units, sanitaryware) are not extracted yet; furniture fitting will not avoid them.',
    });
  }
  for (const w of context.warnings ?? []) {
    add({
      severity: 'warning',
      code: 'extractor-warning',
      category: 'structural_ambiguity',
      impact: 'geometry-uncertain',
      message: w,
    });
  }
  const doc = context.document;
  if (doc && doc.verdict !== 'LIKELY_FLOOR_PLAN') {
    const unlikely = doc.verdict === 'UNLIKELY_FLOOR_PLAN';
    add({
      severity: 'warning',
      code: 'document-uncertain',
      category: 'image_quality',
      impact: 'geometry-uncertain',
      message: unlikely
        ? `This image does not look like a floor plan (${pct(doc.confidence)} likely); it was extracted on request, so check everything: ${doc.evidence.join('; ')}.`
        : `This image may not be a clean floor plan (${pct(doc.confidence)} likely): ${doc.evidence.join('; ')}.`,
    });
  }

  const status: ExtractionReview['status'] = problems.some((p) => p.impact === 'geometry-failure')
    ? 'failed'
    : problems.some((p) => p.impact === 'geometry-uncertain' && p.severity !== 'info')
      ? 'needs-review'
      : problems.some((p) => p.severity !== 'info')
        ? 'ok-with-warnings'
        : 'ok';
  return {
    status,
    problems,
    components: assessComponents(ann, cal, problems),
    ...(doc ? { document: doc } : {}),
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Walls: good / Rooms: good / Room labels: uncertain / … — a per-component view. */
export function assessComponents(
  ann: FloorPlanAnnotations,
  cal: ExtractionCalibrationReport | undefined,
  problems: readonly ReviewProblem[],
): Record<ExtractionComponent, ComponentAssessment> {
  const flagged = (...cats: ExtractionIssueCategory[]) =>
    problems.filter((p) => cats.includes(p.category) && p.severity !== 'info');
  // A failure of the whole drawing (style not supported, not a plan) leaves no usable walls or rooms.
  const failed = (...cats: ExtractionIssueCategory[]) =>
    problems.some(
      (p) =>
        [...cats, 'structural_ambiguity', 'image_quality'].includes(p.category) &&
        p.impact === 'geometry-failure',
    );
  const named = ann.rooms.filter((r) => r.labelSource === 'plan-label').length;
  const typed = ann.rooms.filter((r) => r.type !== 'unknown').length;
  const doors = ann.doors.filter((d) => d.kind !== 'opening');
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return {
    walls: {
      status:
        !ann.walls.length || failed('wall_detection')
          ? 'failed'
          : flagged('wall_detection', 'annotation_conflict').length
            ? 'uncertain'
            : 'good',
      confidence: +mean(ann.walls.map((w) => w.confidence ?? 1)).toFixed(3),
      summary: s(ann.walls.length, 'wall'),
    },
    rooms: {
      status:
        !ann.rooms.length || failed('room_detection', 'room_boundary')
          ? 'failed'
          : flagged('room_detection', 'room_boundary').length
            ? 'uncertain'
            : 'good',
      confidence: +mean(ann.rooms.map((r) => r.geometryConfidence ?? r.confidence ?? 1)).toFixed(3),
      summary: s(ann.rooms.length, 'room'),
    },
    roomLabels: {
      status:
        !ann.rooms.length || !typed
          ? 'missing'
          : named < ann.rooms.length || flagged('room_label', 'room_classification').length
            ? 'uncertain'
            : 'good',
      confidence: +mean(
        ann.rooms.map((r) => r.classificationConfidence ?? (r.type === 'unknown' ? 0 : (r.confidence ?? 1))),
      ).toFixed(3),
      summary: `${named} of ${ann.rooms.length} named, ${typed} typed`,
    },
    doors: {
      status: !ann.doors.length ? 'missing' : flagged('door_detection').length ? 'uncertain' : 'good',
      confidence: +mean(ann.doors.map((d) => d.confidence ?? 1)).toFixed(3),
      summary: `${s(doors.length, 'door')}${ann.doors.length > doors.length ? ` + ${ann.doors.length - doors.length} open` : ''}`,
    },
    windows: {
      status: !ann.windows.length ? 'missing' : flagged('window_detection').length ? 'uncertain' : 'good',
      confidence: +mean(ann.windows.map((w) => w.confidence ?? 1)).toFixed(3),
      summary: s(ann.windows.length, 'window'),
    },
    scale: {
      status: !cal
        ? 'missing'
        : cal.strategy === 'estimated' || cal.confidence === 'low'
          ? 'uncertain'
          : 'good',
      confidence: !cal ? 0 : cal.confidence === 'high' ? 0.95 : cal.confidence === 'medium' ? 0.75 : 0.4,
      summary: !cal ? 'no scale' : `${cal.pixelsPerMeter.toFixed(1)} px/m (${cal.strategy})`,
    },
  };
}
