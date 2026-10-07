import type { FloorPlanAnnotations } from '../annotationTypes';
import type { ExtractionCalibrationReport, ExtractionReview, ReviewProblem } from '../extraction';
import { validateAnnotations } from '../validateAnnotations';

export interface ReviewThresholds {
  wall: number;
  door: number;
  window: number;
  room: number;
}

export const DEFAULT_REVIEW_THRESHOLDS: ReviewThresholds = { wall: 0.6, door: 0.6, window: 0.6, room: 0.6 };

const pct = (c: number | undefined) => `${Math.round((c ?? 1) * 100)} %`;

/**
 * Decide whether extracted annotations can be used as-is. Uncertainty is never hidden:
 * every low-confidence or unresolved item becomes a problem the user can review. Annotation
 * errors fail the extraction outright (no misleading 3D model is generated).
 */
export function assessExtraction(
  ann: FloorPlanAnnotations,
  cal: ExtractionCalibrationReport | undefined,
  context: { unplacedLabels?: string[]; refinedDimensions?: string[]; warnings?: string[] } = {},
  thresholds: ReviewThresholds = DEFAULT_REVIEW_THRESHOLDS,
): ExtractionReview {
  const problems: ReviewProblem[] = [];
  const add = (p: ReviewProblem) => problems.push(p);

  for (const issue of validateAnnotations(ann)) {
    add({
      severity: issue.severity === 'error' ? 'error' : 'warning',
      code: `annotation-${issue.code}`,
      message: issue.message,
      ...(issue.elementId ? { elementId: issue.elementId } : {}),
    });
  }

  const weakWalls = ann.walls.filter((w) => (w.confidence ?? 1) < thresholds.wall);
  if (weakWalls.length) {
    add({
      severity: 'warning',
      code: 'low-confidence-walls',
      message: `${weakWalls.length} wall${weakWalls.length > 1 ? 's have' : ' has'} low confidence (${weakWalls.map((w) => `${w.id} ${pct(w.confidence)}`).join(', ')}).`,
      elementIds: weakWalls.map((w) => w.id),
    });
  }
  for (const d of ann.doors) {
    if (d.kind === 'opening') {
      add({
        severity: 'warning',
        code: 'unclassified-opening',
        message: `Opening ${d.id} has no door symbol: it may be a doorway or a door that could not be classified (${pct(d.confidence)}).`,
        elementId: d.id,
      });
    } else if ((d.confidence ?? 1) < thresholds.door) {
      add({
        severity: 'warning',
        code: 'possible-door',
        message: `${d.id} may be a door (${pct(d.confidence)}).`,
        elementId: d.id,
      });
    }
  }
  for (const w of ann.windows) {
    if ((w.confidence ?? 1) < thresholds.window)
      add({
        severity: 'warning',
        code: 'possible-window',
        message: `${w.id} may be a window (${pct(w.confidence)}).`,
        elementId: w.id,
      });
  }
  for (const r of ann.rooms) {
    if (r.labelSource === 'unknown')
      add({
        severity: 'warning',
        code: 'unnamed-room',
        message: `${r.id} has no readable label; it is shown as "Unknown Room".`,
        elementId: r.id,
      });
    else if (r.labelSource === 'inferred')
      add({
        severity: 'info',
        code: 'inferred-room',
        message: `${r.id} is unlabelled; assumed "${r.name}".`,
        elementId: r.id,
      });
    else if ((r.confidence ?? 1) < thresholds.room)
      add({
        severity: 'warning',
        code: 'uncertain-room-label',
        message: `Room label "${r.label?.text ?? r.name}" is uncertain (${pct(r.confidence)}).`,
        elementId: r.id,
      });
  }
  for (const t of context.unplacedLabels ?? []) {
    add({
      severity: 'warning',
      code: 'label-outside-rooms',
      message: `Label "${t}" is not inside any enclosed room; that space was not reconstructed.`,
    });
  }
  for (const t of context.refinedDimensions ?? []) {
    add({
      severity: 'info',
      code: 'dimension-reread',
      message: `Dimension "${t}" was unclear and was read a second time; check it.`,
    });
  }
  if (cal) {
    if (cal.strategy === 'estimated')
      add({
        severity: 'warning',
        code: 'scale-estimated',
        message: `Scale is estimated from ${cal.basis}: real-world sizes are approximate. Enter a known measurement to calibrate.`,
      });
    else if (cal.strategy === 'manual')
      add({ severity: 'info', code: 'scale-manual', message: 'Scale was entered manually.' });
    if (cal.samplesRejected)
      add({
        severity: 'warning',
        code: 'dimension-mismatch',
        message: `${cal.samplesRejected} printed dimension${cal.samplesRejected > 1 ? 's disagree' : ' disagrees'} with the drawing and ${cal.samplesRejected > 1 ? 'were' : 'was'} not used for scale.`,
      });
  }
  if (!ann.fixtures.length)
    add({
      severity: 'info',
      code: 'no-fixtures',
      message:
        'Fixed fittings (kitchen units, sanitaryware) are not extracted yet; furniture fitting will not avoid them.',
    });
  for (const w of context.warnings ?? []) add({ severity: 'warning', code: 'extractor-warning', message: w });
  if (!ann.rooms.length)
    add({ severity: 'error', code: 'no-rooms', message: 'No enclosed rooms were found.' });

  const status = problems.some((p) => p.severity === 'error')
    ? 'failed'
    : problems.some((p) => p.severity === 'warning')
      ? 'needs-review'
      : 'ok';
  return { status, problems };
}
