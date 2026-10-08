import type { RoomType } from '../../domain/types';
import type { RoomNameMatch } from './text';

/**
 * Evidence about one room, gathered by the extractor. Every field is optional: a plan may have
 * no labels, no scale, no symbols. Geometry is final here — a classifier only decides meaning.
 */
export interface RoomEvidence {
  label?: RoomNameMatch;
  /** Floor area in m² and whether the scale behind it was measured (printed/reference). */
  areaM2?: number;
  scaleMeasured?: boolean;
  /** Long side / short side of the room's bounding box. */
  aspect: number;
  doors: number;
  windows: number;
  /** Symbol-less openings (doorways). */
  openings: number;
  /** Bounded (in part) by a railing. */
  railing: boolean;
  /** Share of the boundary on the building's outside. */
  exteriorShare: number;
  neighbours: number;
  /** Optional symbol/fixture/furniture evidence (e.g. 'toilet', 'bath', 'hob', 'bed'). */
  symbols?: string[];
}

export interface RoomClassification {
  type: RoomType;
  /** Confidence in the type (0 when unknown). */
  confidence: number;
  /** Confidence that a label was read correctly (0 when there is none). */
  labelConfidence: number;
  /** Human-readable reasons. */
  evidence: string[];
  /** Best guess when `type` is 'unknown' because the evidence was too weak. */
  suggestedType?: RoomType;
  source: 'label' | 'evidence' | 'none';
}

/** Room classification behind an interface: rules today; a server-side model could implement it. */
export interface RoomClassifier {
  readonly name: string;
  classify(e: RoomEvidence): RoomClassification;
}

const SYMBOL_TYPES: Record<string, RoomType> = {
  toilet: 'toilet',
  bath: 'bathroom',
  shower: 'bathroom',
  basin: 'bathroom',
  hob: 'kitchen',
  sink: 'kitchen',
  'kitchen-counter': 'kitchen',
  bed: 'bedroom',
  sofa: 'living',
};

/**
 * Evidence-based, deterministic classifier. A readable label decides the type (its confidence
 * is the OCR confidence times how unambiguous the word is, lowered when the size contradicts
 * it). Without a label, only strong evidence assigns a type; otherwise the room stays
 * "unknown" with a suggestion recorded — never a confident guess.
 */
export class EvidenceRoomClassifier implements RoomClassifier {
  readonly name = 'evidence-rules';
  constructor(private readonly assignAbove = 0.5) {}

  classify(e: RoomEvidence): RoomClassification {
    const evidence: string[] = [];
    const area = e.areaM2;
    const sizeNote =
      area !== undefined
        ? `area ≈ ${area.toFixed(1)} m²${e.scaleMeasured ? '' : ' (estimated scale)'}`
        : undefined;

    if (e.label) {
      const lc = e.label.confidence;
      let conf = lc * e.label.typeWeight;
      evidence.push(`label "${e.label.raw}" read with ${Math.round(lc * 100)} % confidence`);
      if (e.label.typeWeight < 1) evidence.push(`"${e.label.words.join(' ')}" only suggests the type`);
      // A size that contradicts the label lowers confidence (a 0.8 m² "bedroom" is a misread).
      if (area !== undefined && e.label.type !== 'unknown') {
        const implausible =
          (e.label.type === 'bedroom' && area < 4) ||
          ((e.label.type === 'living' || e.label.type === 'kitchen-living') && area < 5) ||
          (e.label.type === 'storage' && area > 15);
        if (implausible) {
          conf *= 0.6;
          if (sizeNote) evidence.push(`${sizeNote} is unusual for a ${e.label.type}`);
        }
      }
      if (e.label.type === 'unknown') {
        return {
          type: 'unknown',
          confidence: 0,
          labelConfidence: lc,
          evidence: [...evidence, 'the name does not determine a room type'],
          source: 'label',
        };
      }
      if (conf >= 0.35)
        return {
          type: e.label.type,
          confidence: +conf.toFixed(3),
          labelConfidence: lc,
          evidence,
          source: 'label',
        };
      return {
        type: 'unknown',
        confidence: 0,
        labelConfidence: lc,
        evidence,
        suggestedType: e.label.type,
        source: 'label',
      };
    }

    // No label: weigh general evidence. Scores are deliberately conservative.
    const scores = new Map<RoomType, number>();
    const add = (t: RoomType, v: number, why: string) => {
      scores.set(t, Math.max(scores.get(t) ?? 0, v));
      evidence.push(why);
    };
    for (const s of e.symbols ?? []) {
      const t = SYMBOL_TYPES[s];
      if (t) add(t, 0.65, `${s} symbol inside`);
    }
    // Railing-like double lines are also how windows and sliding doors are drawn: a hint only.
    if (e.railing) add('balcony', 0.45, 'next to a railing-like double line');
    if (area !== undefined) {
      const m = e.scaleMeasured ? 1 : 0.85;
      if (area < 1.5 && e.windows === 0 && e.doors + e.openings <= 1)
        add('storage', 0.6 * m, `small enclosed space (${sizeNote}), no window`);
      else if (area < 1.5) add('storage', 0.45 * m, `small space (${sizeNote})`);
      if (e.aspect >= 3 && e.doors + e.openings >= 3)
        add('hall', 0.6 * m, `long and narrow with ${e.doors + e.openings} doors/openings`);
      else if (e.aspect >= 2.5 && e.doors + e.openings >= 2 && e.windows === 0)
        add('hall', 0.42 * m, 'narrow with several doors and no window');
      if (area >= 1.5 && area < 6 && e.windows <= 1 && e.doors + e.openings === 1)
        add('bathroom', 0.35 * m, `small room with one door (${sizeNote})`);
      if (area >= 7 && area < 20 && e.windows >= 1 && e.doors + e.openings === 1)
        add('bedroom', 0.38 * m, `mid-sized room with a window and one door (${sizeNote})`);
      if (area >= 20 && e.windows >= 1) add('living', 0.36 * m, `large room with windows (${sizeNote})`);
    }
    const ranked = [...scores].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    if (!top)
      return {
        type: 'unknown',
        confidence: 0,
        labelConfidence: 0,
        evidence: ['no label and no distinguishing evidence'],
        source: 'none',
      };
    // A second plausible type close behind means the evidence does not decide.
    const contested = ranked[1] && ranked[1][1] > top[1] - 0.1;
    if (top[1] >= this.assignAbove && !contested) {
      return {
        type: top[0],
        confidence: +top[1].toFixed(3),
        labelConfidence: 0,
        evidence,
        source: 'evidence',
      };
    }
    return {
      type: 'unknown',
      confidence: 0,
      labelConfidence: 0,
      evidence,
      suggestedType: top[0],
      source: 'none',
    };
  }
}
