import type { RoomType } from '../../domain/types';
import type { FloorPlanAnnotations } from '../annotationTypes';
import { compareAnnotations, type ExtractionMetrics } from '../cv/metrics';
import type { RgbaImage } from '../cv/raster';
import {
  EXTRACTION_ISSUE_CATEGORIES,
  type ExtractionIssueCategory,
  type ExtractionResult,
  type ExtractionReview,
} from '../extraction';
import { E2_ANNOTATIONS } from '../fixtures/e2/annotations';
import { SYNTHETIC_ANNOTATIONS } from '../fixtures/synthetic/annotations';
import { SYNTHETIC_CORRIDOR_ANNOTATIONS } from '../fixtures/synthetic-corridor/annotations';
import { SYNTHETIC_MM_ANNOTATIONS } from '../fixtures/synthetic-mm/annotations';
import { degradeImage, scaleAnnotations, type DegradeOps } from './degrade';

/**
 * Test corpus of floor plans (tests/fixtures/floorplans/<category>/<id>/fixture.json).
 * Fixtures can be fully annotated (ground-truth annotations → geometric metrics), partially
 * annotated (facts a person can read off the plan: room count, room types, labels, scale
 * source), or qualitative (only "does it behave sensibly"). Real-world images are not stored
 * in the repository: they are fetched into a git-ignored cache from their documented source.
 */
export type FixtureCategory = 'e2' | 'synthetic' | 'real-world' | 'pathological';

export interface CorpusFixture {
  id: string;
  category: FixtureCategory;
  annotation: 'full' | 'partial' | 'qualitative';
  description: string;
  image:
    | { path: string }
    | { cache: string; url: string; sha256: string }
    | { generate: { kind: 'noise' | 'blank'; width: number; height: number; seed?: number } }
    | { derive: { from: string; ops: DegradeOps } };
  /** Where the image comes from and under which licence. */
  source?: { title?: string; page?: string; license?: string; licenseUrl?: string; author?: string };
  /** Full ground truth: a registered annotation set (scaled if the image is resized). */
  groundTruth?: string;
  /** Partial ground truth: facts read off the plan by a person. */
  truth?: { rooms?: number; roomTypes?: RoomType[]; labels?: string[]; scaleSource?: 'printed' | 'none' };
  /** Hard expectations for regression tests (conservative floors, not targets). */
  expect?: {
    status?: ExtractionReview['status'][];
    documentVerdict?: 'LIKELY_FLOOR_PLAN' | 'UNCERTAIN' | 'UNLIKELY_FLOOR_PLAN';
    minRooms?: number;
    maxRooms?: number;
    roomTypes?: RoomType[];
    scaleStrategy?: string;
    failureCategory?: ExtractionIssueCategory;
    minWallRecall?: number;
    minRoomDetection?: number;
    minDoorRecall?: number;
    minWindowRecall?: number;
    maxScaleError?: number;
    maxSeconds?: number;
  };
  notes?: string;
}

const GROUND_TRUTH: Record<string, FloorPlanAnnotations> = {
  e2: E2_ANNOTATIONS,
  'synthetic-angled': SYNTHETIC_ANNOTATIONS,
  'synthetic-mm': SYNTHETIC_MM_ANNOTATIONS,
  'synthetic-corridor': SYNTHETIC_CORRIDOR_ANNOTATIONS,
};

/** Full ground truth for a fixture, scaled to match a resized derived image. */
export function groundTruthFor(f: CorpusFixture): FloorPlanAnnotations | undefined {
  if (!f.groundTruth) return undefined;
  const base = GROUND_TRUTH[f.groundTruth];
  if (!base) throw new Error(`Unknown ground truth "${f.groundTruth}" in fixture ${f.id}`);
  const k = 'derive' in f.image ? (f.image.derive.ops.scale ?? 1) : 1;
  return k === 1 ? base : scaleAnnotations(base, k);
}

/** Build a generated or derived image (others are loaded from disk by the caller). */
export function synthesiseImage(
  f: CorpusFixture,
  load: (fixtureId: string) => RgbaImage | null,
): RgbaImage | null {
  if ('generate' in f.image) {
    const { kind, width, height, seed } = f.image.generate;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    if (kind === 'noise') {
      let s = (seed ?? 1) >>> 0;
      for (let i = 0; i < data.length; i += 4) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        data[i] = data[i + 1] = data[i + 2] = s >>> 24;
      }
    }
    return { width, height, data };
  }
  if ('derive' in f.image) {
    const base = load(f.image.derive.from);
    return base ? degradeImage(base, f.image.derive.ops) : null;
  }
  return null;
}

export interface FixtureOutcome {
  id: string;
  category: FixtureCategory;
  annotation: CorpusFixture['annotation'];
  status: ExtractionReview['status'] | 'missing-image';
  seconds: number;
  rooms: number;
  roomTypes: RoomType[];
  metrics?: ExtractionMetrics;
  partial?: { roomCountRatio?: number; typeRecall?: number; labelRecall?: number; scaleFromPrint?: boolean };
  /** Problems by category (warnings and errors). */
  issues: Partial<Record<ExtractionIssueCategory, number>>;
  /** Hard expectation checks. */
  checks: { name: string; pass: boolean; detail: string }[];
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

export function evaluateFixture(f: CorpusFixture, r: ExtractionResult, seconds: number): FixtureOutcome {
  const ann = r.annotations;
  const status = r.review?.status ?? 'failed';
  const issues: Partial<Record<ExtractionIssueCategory, number>> = {};
  for (const p of r.review?.problems ?? [])
    if (p.severity !== 'info') issues[p.category] = (issues[p.category] ?? 0) + 1;
  const roomTypes = [...new Set(ann.rooms.map((x) => x.type))];
  const gt = groundTruthFor(f);
  const metrics = gt && ann.rooms.length ? compareAnnotations(gt, ann) : undefined;
  let partial: FixtureOutcome['partial'];
  if (f.truth) {
    const readLabels = (ann.labels ?? []).map((l) => norm(l.text));
    partial = {
      ...(f.truth.rooms ? { roomCountRatio: +(ann.rooms.length / f.truth.rooms).toFixed(2) } : {}),
      ...(f.truth.roomTypes?.length
        ? {
            typeRecall: +(
              f.truth.roomTypes.filter((t) => roomTypes.includes(t)).length / f.truth.roomTypes.length
            ).toFixed(2),
          }
        : {}),
      ...(f.truth.labels?.length
        ? {
            labelRecall: +(
              f.truth.labels.filter((t) => readLabels.some((x) => x.includes(norm(t)) || norm(t).includes(x)))
                .length / f.truth.labels.length
            ).toFixed(2),
          }
        : {}),
      ...(f.truth.scaleSource === 'printed'
        ? { scaleFromPrint: r.calibration?.strategy === 'dimension-labels' }
        : {}),
    };
  }
  const checks: FixtureOutcome['checks'] = [];
  const e = f.expect ?? {};
  const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  if (e.status) check('status', e.status.includes(status), `${status} (allowed: ${e.status.join(', ')})`);
  if (e.documentVerdict)
    check(
      'document',
      r.review?.document?.verdict === e.documentVerdict,
      `${r.review?.document?.verdict} (expected ${e.documentVerdict})`,
    );
  if (e.minRooms !== undefined)
    check('min rooms', ann.rooms.length >= e.minRooms, `${ann.rooms.length} ≥ ${e.minRooms}`);
  if (e.maxRooms !== undefined)
    check('max rooms', ann.rooms.length <= e.maxRooms, `${ann.rooms.length} ≤ ${e.maxRooms}`);
  if (e.roomTypes)
    for (const t of e.roomTypes)
      check(`room type ${t}`, roomTypes.includes(t), `found: ${roomTypes.join(', ')}`);
  if (e.scaleStrategy)
    check(
      'scale',
      r.calibration?.strategy === e.scaleStrategy,
      `${r.calibration?.strategy} (expected ${e.scaleStrategy})`,
    );
  if (e.failureCategory) {
    const reported = (r.review?.problems ?? []).some(
      (p) => p.category === e.failureCategory && p.impact === 'geometry-failure',
    );
    check('honest failure', status === 'failed' && reported, `failed with ${e.failureCategory}: ${reported}`);
  }
  if (e.maxSeconds !== undefined)
    check('time', seconds <= e.maxSeconds, `${seconds.toFixed(1)} s ≤ ${e.maxSeconds} s`);
  if (metrics) {
    if (e.minWallRecall !== undefined)
      check(
        'wall recall',
        metrics.walls.recall >= e.minWallRecall,
        `${metrics.walls.recall.toFixed(3)} ≥ ${e.minWallRecall}`,
      );
    if (e.minRoomDetection !== undefined)
      check(
        'room detection',
        metrics.rooms.detectionRate >= e.minRoomDetection,
        `${metrics.rooms.detectionRate.toFixed(3)} ≥ ${e.minRoomDetection}`,
      );
    if (e.minDoorRecall !== undefined)
      check(
        'door recall',
        metrics.doors.recall >= e.minDoorRecall,
        `${metrics.doors.recall.toFixed(3)} ≥ ${e.minDoorRecall}`,
      );
    if (e.minWindowRecall !== undefined)
      check(
        'window recall',
        metrics.windows.recall >= e.minWindowRecall,
        `${metrics.windows.recall.toFixed(3)} ≥ ${e.minWindowRecall}`,
      );
    if (e.maxScaleError !== undefined)
      check(
        'scale error',
        metrics.scale.relativeError <= e.maxScaleError,
        `${(metrics.scale.relativeError * 100).toFixed(2)} % ≤ ${e.maxScaleError * 100} %`,
      );
  } else if (gt && (e.minWallRecall ?? e.minRoomDetection) !== undefined) {
    check('metrics', false, 'no rooms extracted, so metrics could not be computed');
  }
  return {
    id: f.id,
    category: f.category,
    annotation: f.annotation,
    status,
    seconds,
    rooms: ann.rooms.length,
    roomTypes,
    ...(metrics ? { metrics } : {}),
    ...(partial ? { partial } : {}),
    issues,
    checks,
  };
}

export function missingImage(f: CorpusFixture): FixtureOutcome {
  return {
    id: f.id,
    category: f.category,
    annotation: f.annotation,
    status: 'missing-image',
    seconds: 0,
    rooms: 0,
    roomTypes: [],
    issues: {},
    checks: [],
  };
}

const pct = (x: number | undefined) =>
  x === undefined || !Number.isFinite(x) ? '—' : `${Math.round(x * 100)} %`;

/** Plain-text corpus report: per fixture, and failure counts by category. */
export function formatCorpusReport(outcomes: FixtureOutcome[]): string {
  const lines: string[] = ['# Floor-plan extraction corpus report', ''];
  lines.push(
    '| fixture | category | annotation | status | s | rooms | walls P/R | rooms det. / IoU | label acc. | type acc. | doors P/R | windows P/R | scale err | partial (rooms / types / labels) |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const o of outcomes) {
    const m = o.metrics;
    const p = o.partial;
    lines.push(
      `| ${o.id} | ${o.category} | ${o.annotation} | ${o.status} | ${o.seconds.toFixed(1)} | ${o.rooms} | ${m ? `${pct(m.walls.precision)} / ${pct(m.walls.recall)}` : '—'} | ${m ? `${pct(m.rooms.detectionRate)} / ${m.rooms.meanIoU.toFixed(3)}` : '—'} | ${m ? pct(m.rooms.labelAccuracy) : '—'} | ${m ? pct(m.rooms.classificationAccuracy) : '—'} | ${m ? `${pct(m.doors.precision)} / ${pct(m.doors.recall)}` : '—'} | ${m ? `${pct(m.windows.precision)} / ${pct(m.windows.recall)}` : '—'} | ${m ? `${(m.scale.relativeError * 100).toFixed(2)} %` : '—'} | ${p ? `${p.roomCountRatio ?? '—'} / ${pct(p.typeRecall)} / ${pct(p.labelRecall)}` : '—'} |`,
    );
  }
  const ran = outcomes.filter((o) => o.status !== 'missing-image');
  lines.push('', '## Problems by category (fixtures affected / total problems)', '');
  for (const c of EXTRACTION_ISSUE_CATEGORIES) {
    const affected = ran.filter((o) => o.issues[c]).length;
    const total = ran.reduce((s, o) => s + (o.issues[c] ?? 0), 0);
    if (affected) lines.push(`- ${c}: ${affected} / ${total}`);
  }
  const failedChecks = ran.flatMap((o) =>
    o.checks.filter((c) => !c.pass).map((c) => `${o.id}: ${c.name} — ${c.detail}`),
  );
  lines.push(
    '',
    `## Expectation checks: ${ran.reduce((s, o) => s + o.checks.length, 0) - failedChecks.length} passed, ${failedChecks.length} failed`,
    ...failedChecks.map((c) => `- ${c}`),
  );
  const missing = outcomes.filter((o) => o.status === 'missing-image').map((o) => o.id);
  if (missing.length)
    lines.push(
      '',
      `Not run (image not in the local cache — run \`npm run corpus:fetch\`): ${missing.join(', ')}`,
    );
  return lines.join('\n');
}
