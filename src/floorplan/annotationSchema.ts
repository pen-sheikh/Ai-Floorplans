import type { DoorKind, FixtureKind, RoomType, WallKind, WindowKind } from '../domain/types';
import { ANNOTATION_FORMAT_VERSION, type FloorPlanAnnotations } from './annotationTypes';

/**
 * Runtime check of FloorPlanAnnotations received from outside the app — a server-side
 * extractor or a vision model. Such output is DATA: it is parsed strictly and rejected (never
 * repaired) when it does not match the schema, then goes through the same validation and
 * reconstruction as every other annotation set. Nothing from it reaches rendering directly.
 */
export type AnnotationParseResult =
  { ok: true; annotations: FloorPlanAnnotations } | { ok: false; errors: string[] };

const ROOM_TYPES = [
  'living',
  'kitchen',
  'kitchen-living',
  'dining',
  'bedroom',
  'bathroom',
  'toilet',
  'hall',
  'balcony',
  'storage',
  'utility',
  'unknown',
] as const satisfies readonly RoomType[];
const WALL_KINDS = ['exterior', 'interior', 'railing'] as const satisfies readonly WallKind[];
const DOOR_KINDS = [
  'hinged',
  'double',
  'sliding',
  'bifold',
  'opening',
] as const satisfies readonly DoorKind[];
const WINDOW_KINDS = [
  'standard',
  'large',
  'sliding-door',
  'balcony-door',
] as const satisfies readonly WindowKind[];
const FIXTURE_KINDS = [
  'bath',
  'shower',
  'toilet',
  'basin',
  'kitchen-counter',
  'sink',
  'hob',
  'built-in-unit',
  'column',
  'shaft',
] as const satisfies readonly FixtureKind[];
// Compile-time completeness: adding a member to a domain union without listing it here fails.
type Missing<T, L extends readonly unknown[]> = Exclude<T, L[number]>;
const complete: [
  Missing<RoomType, typeof ROOM_TYPES>,
  Missing<WallKind, typeof WALL_KINDS>,
  Missing<DoorKind, typeof DOOR_KINDS>,
  Missing<WindowKind, typeof WINDOW_KINDS>,
  Missing<FixtureKind, typeof FIXTURE_KINDS>,
] extends [never, never, never, never, never]
  ? true
  : false = true;
void complete;

const LIMITS = { maxElements: 2000, maxPolygon: 500, maxImagePx: 20_000, maxText: 300 };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseAnnotationsJson(raw: unknown): AnnotationParseResult {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ['Not valid JSON.'] };
    }
  }
  const errors: string[] = [];
  const err = (path: string, msg: string) => {
    if (errors.length < 50) errors.push(`${path}: ${msg}`);
  };

  const num = (v: unknown, path: string, min = -LIMITS.maxImagePx, max = LIMITS.maxImagePx) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      err(path, `expected a number in [${min}, ${max}]`);
  };
  const str = (v: unknown, path: string, optional = false) => {
    if (optional && v === undefined) return;
    if (typeof v !== 'string' || !v.length || v.length > LIMITS.maxText)
      err(path, 'expected a non-empty string');
  };
  const oneOf = (v: unknown, values: readonly string[], path: string) => {
    if (typeof v !== 'string' || !values.includes(v)) err(path, `expected one of ${values.join(', ')}`);
  };
  const keys = (o: Record<string, unknown>, allowed: string[], path: string) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) err(path, `unexpected field "${k}"`);
  };
  const point = (v: unknown, path: string) => {
    if (!isObj(v)) return err(path, 'expected {x, y}');
    keys(v, ['x', 'y'], path);
    num(v.x, `${path}.x`);
    num(v.y, `${path}.y`);
  };
  const points = (v: unknown, path: string, min: number) => {
    if (!Array.isArray(v) || v.length < min || v.length > LIMITS.maxPolygon)
      return err(path, `expected ${min}–${LIMITS.maxPolygon} points`);
    v.forEach((p, i) => point(p, `${path}[${i}]`));
  };
  const rect = (v: unknown, path: string) => {
    if (!isObj(v)) return err(path, 'expected {x0, y0, x1, y1}');
    keys(v, ['x0', 'y0', 'x1', 'y1'], path);
    for (const k of ['x0', 'y0', 'x1', 'y1']) num(v[k], `${path}.${k}`);
  };
  const confidence = (o: Record<string, unknown>, path: string) => {
    if (o.confidence !== undefined) num(o.confidence, `${path}.confidence`, 0, 1);
  };
  const span = (v: unknown, path: string) => {
    if (!Array.isArray(v) || v.length !== 2) return err(path, 'expected [from, to]');
    num(v[0], `${path}[0]`);
    num(v[1], `${path}[1]`);
  };
  const dimension = (v: unknown, path: string) => {
    if (!isObj(v)) return err(path, 'expected a dimension object');
    keys(v, ['id', 'meters', 'kind', 'text', 'confidence', 'axis', 'span', 'a', 'b'], path);
    num(v.meters, `${path}.meters`, 0.01, 1000);
    if (v.kind !== undefined) oneOf(v.kind, ['printed', 'reference'], `${path}.kind`);
    str(v.text, `${path}.text`, true);
    confidence(v, path);
    if ('axis' in v) {
      oneOf(v.axis, ['x', 'y'], `${path}.axis`);
      span(v.span, `${path}.span`);
    } else {
      point(v.a, `${path}.a`);
      point(v.b, `${path}.b`);
    }
  };
  const list = (
    v: unknown,
    path: string,
    each: (o: Record<string, unknown>, p: string) => void,
    optional = false,
  ) => {
    if (optional && v === undefined) return;
    if (!Array.isArray(v) || v.length > LIMITS.maxElements) return err(path, 'expected an array');
    v.forEach((o, i) => (isObj(o) ? each(o, `${path}[${i}]`) : err(`${path}[${i}]`, 'expected an object')));
  };

  if (!isObj(data)) return { ok: false, errors: ['Expected a JSON object.'] };
  const a = data;
  keys(
    a,
    [
      'formatVersion',
      'id',
      'name',
      'building',
      'floorLabel',
      'level',
      'source',
      'image',
      'originPx',
      'reportedArea',
      'internalEnvelope',
      'footprint',
      'compass',
      'calibration',
      'defaults',
      'walls',
      'doors',
      'windows',
      'rooms',
      'fixtures',
      'labels',
      'drawingNotes',
      'inferredBoundaries',
    ],
    'annotations',
  );
  if (a.formatVersion !== ANNOTATION_FORMAT_VERSION)
    err('formatVersion', `expected ${ANNOTATION_FORMAT_VERSION}`);
  str(a.id, 'id');
  str(a.name, 'name');
  str(a.building, 'building', true);
  str(a.floorLabel, 'floorLabel', true);
  num(a.level, 'level', -10, 200);
  if (!isObj(a.source)) err('source', 'expected {method, producer?, confidence?}');
  else {
    keys(a.source, ['method', 'producer', 'confidence'], 'source');
    oneOf(a.source.method, ['manual', 'automatic'], 'source.method');
    str(a.source.producer, 'source.producer', true);
    confidence(a.source, 'source');
  }
  if (!isObj(a.image)) err('image', 'expected {file, widthPx, heightPx}');
  else {
    keys(a.image, ['file', 'widthPx', 'heightPx'], 'image');
    str(a.image.file, 'image.file');
    num(a.image.widthPx, 'image.widthPx', 1);
    num(a.image.heightPx, 'image.heightPx', 1);
  }
  point(a.originPx, 'originPx');
  if (a.reportedArea !== undefined) {
    if (!isObj(a.reportedArea)) err('reportedArea', 'expected {m2, note}');
    else num(a.reportedArea.m2, 'reportedArea.m2', 0.1, 100_000);
  }
  if (a.internalEnvelope !== undefined) points(a.internalEnvelope, 'internalEnvelope', 3);
  points(a.footprint, 'footprint', 0);
  if (a.compass !== undefined) {
    if (!isObj(a.compass)) err('compass', 'expected {center, northTip}');
    else {
      point(a.compass.center, 'compass.center');
      point(a.compass.northTip, 'compass.northTip');
    }
  }
  if (a.calibration !== undefined) {
    if (!isObj(a.calibration)) err('calibration', 'expected an object');
    else {
      keys(a.calibration, ['references', 'manualPixelsPerMeter', 'estimatedPixelsPerMeter'], 'calibration');
      if (a.calibration.references !== undefined) {
        if (!Array.isArray(a.calibration.references)) err('calibration.references', 'expected an array');
        else a.calibration.references.forEach((d, i) => dimension(d, `calibration.references[${i}]`));
      }
      if (a.calibration.manualPixelsPerMeter !== undefined)
        num(a.calibration.manualPixelsPerMeter, 'calibration.manualPixelsPerMeter', 0.01, 100_000);
      const est = a.calibration.estimatedPixelsPerMeter;
      if (est !== undefined) {
        if (!isObj(est)) err('calibration.estimatedPixelsPerMeter', 'expected {value, basis}');
        else {
          num(est.value, 'calibration.estimatedPixelsPerMeter.value', 0.01, 100_000);
          str(est.basis, 'calibration.estimatedPixelsPerMeter.basis');
        }
      }
    }
  }
  if (!isObj(a.defaults)) err('defaults', 'expected heights');
  else
    for (const k of [
      'ceilingHeightMeters',
      'doorHeightMeters',
      'railingHeightMeters',
      'windowSillMeters',
      'windowHeadMeters',
    ])
      num(a.defaults[k], `defaults.${k}`, 0, 20);

  list(a.walls, 'walls', (w, p) => {
    keys(w, ['id', 'kind', 'confidence', 'note', 'rect', 'segment'], p);
    str(w.id, `${p}.id`);
    oneOf(w.kind, WALL_KINDS, `${p}.kind`);
    confidence(w, p);
    if ('rect' in w) rect(w.rect, `${p}.rect`);
    else if (isObj(w.segment)) {
      keys(w.segment, ['a', 'b', 'thicknessPx'], `${p}.segment`);
      point(w.segment.a, `${p}.segment.a`);
      point(w.segment.b, `${p}.segment.b`);
      num(w.segment.thicknessPx, `${p}.segment.thicknessPx`, 0.1, 1000);
    } else err(p, 'expected rect or segment');
  });
  list(a.doors, 'doors', (d, p) => {
    keys(
      d,
      [
        'id',
        'wallId',
        'span',
        'kind',
        'hinge',
        'swing',
        'swingConfidence',
        'label',
        'heightMeters',
        'heightFromPlan',
        'confidence',
        'note',
      ],
      p,
    );
    str(d.id, `${p}.id`);
    str(d.wallId, `${p}.wallId`);
    span(d.span, `${p}.span`);
    oneOf(d.kind, DOOR_KINDS, `${p}.kind`);
    oneOf(d.hinge, ['min', 'max'], `${p}.hinge`);
    oneOf(d.swing, ['up', 'down', 'left', 'right'], `${p}.swing`);
    if (d.swingConfidence !== undefined) num(d.swingConfidence, `${p}.swingConfidence`, 0, 1);
    if (d.heightMeters !== undefined) num(d.heightMeters, `${p}.heightMeters`, 0.5, 5);
    confidence(d, p);
  });
  list(a.windows, 'windows', (w, p) => {
    keys(
      w,
      [
        'id',
        'wallId',
        'span',
        'kind',
        'sillHeightMeters',
        'headHeightMeters',
        'heightsFromPlan',
        'confidence',
        'note',
      ],
      p,
    );
    str(w.id, `${p}.id`);
    str(w.wallId, `${p}.wallId`);
    span(w.span, `${p}.span`);
    oneOf(w.kind, WINDOW_KINDS, `${p}.kind`);
    confidence(w, p);
  });
  list(a.rooms, 'rooms', (r, p) => {
    keys(
      r,
      [
        'id',
        'name',
        'type',
        'labelSource',
        'label',
        'labelId',
        'polygon',
        'dimensions',
        'exterior',
        'confidence',
        'note',
        'geometryConfidence',
        'labelConfidence',
        'classificationConfidence',
        'classification',
      ],
      p,
    );
    str(r.id, `${p}.id`);
    str(r.name, `${p}.name`);
    oneOf(r.type, ROOM_TYPES, `${p}.type`);
    oneOf(r.labelSource, ['plan-label', 'inferred', 'unknown'], `${p}.labelSource`);
    for (const k of ['geometryConfidence', 'labelConfidence', 'classificationConfidence']) {
      if (r[k] !== undefined) num(r[k], `${p}.${k}`, 0, 1);
    }
    if (r.classification !== undefined) {
      if (!isObj(r.classification) || !Array.isArray(r.classification.evidence))
        err(`${p}.classification`, 'expected {evidence[], suggestedType?}');
      else if (r.classification.suggestedType !== undefined)
        oneOf(r.classification.suggestedType, ROOM_TYPES, `${p}.classification.suggestedType`);
    }
    points(r.polygon, `${p}.polygon`, 3);
    if (r.dimensions !== undefined) {
      if (!Array.isArray(r.dimensions)) err(`${p}.dimensions`, 'expected an array');
      else r.dimensions.forEach((d, i) => dimension(d, `${p}.dimensions[${i}]`));
    }
    confidence(r, p);
  });
  list(a.fixtures, 'fixtures', (f, p) => {
    str(f.id, `${p}.id`);
    oneOf(f.kind, FIXTURE_KINDS, `${p}.kind`);
    str(f.label, `${p}.label`);
    str(f.materialId, `${p}.materialId`);
    num(f.heightMeters, `${p}.heightMeters`, 0, 5);
    if ('rect' in f) rect(f.rect, `${p}.rect`);
    else points(f.polygon, `${p}.polygon`, 3);
    confidence(f, p);
  });
  list(
    a.labels,
    'labels',
    (l, p) => {
      str(l.id, `${p}.id`);
      str(l.text, `${p}.text`);
      point(l.at, `${p}.at`);
      oneOf(l.role, ['room-name', 'dimension', 'title', 'other'], `${p}.role`);
    },
    true,
  );
  list(a.drawingNotes, 'drawingNotes', (n, p) => {
    str(n.id, `${p}.id`);
    str(n.message, `${p}.message`);
  });
  list(
    a.inferredBoundaries,
    'inferredBoundaries',
    (b, p) => {
      str(b.id, `${p}.id`);
      point(b.a, `${p}.a`);
      point(b.b, `${p}.b`);
      str(b.reason, `${p}.reason`);
    },
    true,
  );

  return errors.length
    ? { ok: false, errors }
    : { ok: true, annotations: data as unknown as FloorPlanAnnotations };
}

/**
 * Instructions for a vision model run SERVER-SIDE behind RemoteExtractionService. The model
 * returns annotations only — never geometry, meshes or scene code — and its answer is parsed
 * with parseAnnotationsJson and reviewed like any other extraction.
 */
export const VISION_EXTRACTION_INSTRUCTIONS = `You are reading an architectural floor plan image of W×H pixels.
Return ONLY a JSON object {"annotations": FloorPlanAnnotations} (formatVersion ${ANNOTATION_FORMAT_VERSION}). All coordinates are image pixels (pixel edges, origin top-left, y down).
- walls: {id, kind: exterior|interior|railing, segment: {a:{x,y}, b:{x,y}, thicknessPx}, confidence 0–1}. One record per straight wall; walls continue across doors and windows.
- doors: {id, wallId, span:[from,to] on the wall's dominant axis (x if closer to horizontal), kind: ${DOOR_KINDS.join('|')}, hinge: min|max, swing: up|down|left|right, confidence}.
- windows: {id, wallId, span, kind: ${WINDOW_KINDS.join('|')}, confidence}.
- rooms: {id, name, type: ${ROOM_TYPES.join('|')}, labelSource: plan-label|inferred|unknown, polygon (inner wall faces), dimensions?: printed sizes with the spans they measure, exterior?: true for balconies}.
- calibration.references: printed dimension lines {meters, text, a, b}. Never invent a scale; if none is printed, omit it.
- defaults: heights not shown on the plan (assumptions). source: {method: "automatic", producer, confidence}.
- Report uncertainty in "confidence"; do not guess unreadable labels (use type "unknown").
No other fields. No prose.`;
