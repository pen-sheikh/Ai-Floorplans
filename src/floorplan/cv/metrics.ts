import type {
  AnnotatedDoor,
  AnnotatedWindow,
  FloorPlanAnnotations,
  PxDirection,
  PxPoint,
} from '../annotationTypes';
import { calibrateAnnotations } from '../calibrate';
import { pxWallGeometry, spanAlongWall, type PxWallGeometry } from '../wallGeometry';
import { fillPolygon, newMask } from './raster';

/**
 * Compare extracted annotations against ground truth. Geometry errors are measured in metres
 * at the GROUND-TRUTH scale, so they are independent of the extractor's own calibration
 * (whose error is reported separately). No single blended score: every category is reported.
 */
export interface Stats {
  mean: number;
  median: number;
  max: number;
  n: number;
}

export interface ExtractionMetrics {
  scale: { truthPxPerM: number; extractedPxPerM: number; relativeError: number; strategy?: string };
  walls: {
    expected: number;
    detected: number;
    extractedCount: number;
    falsePositives: number;
    /** Ground-truth walls whose centreline is ≥ 80 % covered by extracted walls. */
    detectionRate: number;
    endpointErrorM: Stats;
    /** Detected walls whose kind (exterior / interior / railing) matches. */
    kindCorrect: number;
    kindWrong: string[];
    missed: string[];
  };
  rooms: {
    expected: number;
    matched: number;
    meanIoU: number;
    minIoU: number;
    meanIoUAll: number;
    missed: string[];
    labelsCorrect: number;
    perRoom: { id: string; iou: number; matchedId?: string }[];
  };
  doors: OpeningMetrics & { swingCorrect: number; hingedCompared: number };
  windows: OpeningMetrics;
}

export interface OpeningMetrics {
  expected: number;
  detected: number;
  extractedCount: number;
  falsePositives: number;
  detectionRate: number;
  positionErrorM: Stats;
  widthErrorM: Stats;
  missed: string[];
}

export function stats(xs: number[]): Stats {
  if (!xs.length) return { mean: NaN, median: NaN, max: NaN, n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return {
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    median: s[Math.floor(s.length / 2)]!,
    max: s[s.length - 1]!,
    n: s.length,
  };
}

const dist = (a: PxPoint, b: PxPoint) => Math.hypot(a.x - b.x, a.y - b.y);

function pointSegDist(p: PxPoint, g: PxWallGeometry): { d: number; t: number } {
  const t = (p.x - g.a.x) * g.dir.x + (p.y - g.a.y) * g.dir.y;
  const tc = Math.max(0, Math.min(g.lengthPx, t));
  const q = { x: g.a.x + g.dir.x * tc, y: g.a.y + g.dir.y * tc };
  return { d: dist(p, q), t };
}

export function compareAnnotations(
  truth: FloorPlanAnnotations,
  extracted: FloorPlanAnnotations,
): ExtractionMetrics {
  const truthCal = calibrateAnnotations(truth);
  const ppm = truthCal.pixelsPerMeter;
  let exPpm = NaN;
  let strategy: string | undefined;
  try {
    const c = calibrateAnnotations(extracted);
    exPpm = c.pixelsPerMeter;
    strategy = c.method;
  } catch {
    /* no scale */
  }

  // ── Walls ──────────────────────────────────────────────────────────────────────
  const gt = truth.walls.map((w) => ({ id: w.id, kind: w.kind, g: pxWallGeometry(w) }));
  const ex = extracted.walls.map((w) => ({ id: w.id, kind: w.kind, g: pxWallGeometry(w) }));
  const parallel = (a: PxWallGeometry, b: PxWallGeometry) =>
    Math.abs(a.dir.x * b.dir.x + a.dir.y * b.dir.y) > 0.96;
  const covers = (src: PxWallGeometry, by: PxWallGeometry[]) => {
    let hit = 0;
    let n = 0;
    for (let t = 0; t <= src.lengthPx; t += 2) {
      n++;
      const p = { x: src.a.x + src.dir.x * t, y: src.a.y + src.dir.y * t };
      if (
        by.some(
          (o) =>
            parallel(src, o) &&
            pointSegDist(p, o).d <= Math.max(3, 0.6 * Math.max(src.thicknessPx, o.thicknessPx)),
        )
      )
        hit++;
    }
    return n ? hit / n : 0;
  };
  const exG = ex.map((e) => e.g);
  const gtG = gt.map((e) => e.g);
  const endpointErr: number[] = [];
  const missedWalls: string[] = [];
  let detectedWalls = 0;
  let kindCorrect = 0;
  const kindWrong: string[] = [];
  for (const w of gt) {
    if (covers(w.g, exG) >= 0.8) {
      detectedWalls++;
      const byCover = ex.map((e) => ({ e, c: covers(w.g, [e.g]) })).sort((p, q) => q.c - p.c)[0];
      if (byCover?.e.kind === w.kind) kindCorrect++;
      else kindWrong.push(`${w.id}: ${w.kind} → ${byCover?.e.kind ?? '?'}`);
      const near = exG.filter(
        (o) =>
          parallel(w.g, o) &&
          pointSegDist({ x: (w.g.a.x + w.g.b.x) / 2, y: (w.g.a.y + w.g.b.y) / 2 }, o).d <=
            Math.max(3, 0.6 * Math.max(w.g.thicknessPx, o.thicknessPx)),
      );
      for (const end of [w.g.a, w.g.b]) {
        // Where the truth continues straight on in another wall it is only split, not ended;
        // how a straight run is divided into records is not a geometric error.
        if (
          gtG.some(
            (o) =>
              o !== w.g &&
              parallel(o, w.g) &&
              [o.a, o.b].some((e) => dist(e, end) <= Math.max(3, 0.6 * w.g.thicknessPx)),
          )
        )
          continue;
        const ends = near.flatMap((o) => [o.a, o.b]);
        // An end that runs into another wall may be recorded anywhere across that wall's
        // thickness (centreline or outer face are both common conventions): along the wall,
        // errors up to half the met wall's thickness are not errors.
        const met = gtG.filter(
          (o) => o !== w.g && !parallel(o, w.g) && pointSegDist(end, o).d <= o.thicknessPx / 2 + 1,
        );
        const slack = met.length ? Math.max(...met.map((o) => o.thicknessPx / 2)) : 0;
        const err = (e: PxPoint) => {
          const dx = e.x - end.x;
          const dy = e.y - end.y;
          const alongErr = Math.abs(dx * w.g.dir.x + dy * w.g.dir.y);
          const perp = Math.abs(-dx * w.g.dir.y + dy * w.g.dir.x);
          return Math.hypot(Math.max(0, alongErr - slack), perp);
        };
        // Where the truth wall ends, the extracted line(s) should end too (they may be split).
        const best = Math.min(...ends.map(err));
        if (Number.isFinite(best)) endpointErr.push(best / ppm);
      }
    } else missedWalls.push(w.id);
  }
  const falseWalls = ex.filter((e) => covers(e.g, gtG) < 0.5).length;

  // ── Rooms (IoU on the pixel grid) ──────────────────────────────────────────────
  const W = truth.image.widthPx;
  const H = truth.image.heightPx;
  const raster = (poly: PxPoint[]) => {
    const m = newMask(W, H);
    fillPolygon(m, poly);
    return m;
  };
  const exMasks = extracted.rooms.map((r) => ({ r, m: raster(r.polygon) }));
  const perRoom: { id: string; iou: number; matchedId?: string }[] = [];
  let labelsCorrect = 0;
  for (const r of truth.rooms) {
    const m = raster(r.polygon);
    let best = 0;
    let bestId: string | undefined;
    let bestType: string | undefined;
    for (const e of exMasks) {
      let inter = 0;
      let uni = 0;
      for (let i = 0; i < m.data.length; i++) {
        const a = m.data[i]!;
        const b = e.m.data[i]!;
        if (a && b) inter++;
        if (a || b) uni++;
      }
      const iou = uni ? inter / uni : 0;
      if (iou > best) {
        best = iou;
        bestId = e.r.id;
        bestType = e.r.type;
      }
    }
    perRoom.push({
      id: r.id,
      iou: +best.toFixed(4),
      ...(best >= 0.5 && bestId ? { matchedId: bestId } : {}),
    });
    if (best >= 0.5 && bestType === r.type) labelsCorrect++;
  }
  const matched = perRoom.filter((p) => p.matchedId);

  return {
    scale: {
      truthPxPerM: ppm,
      extractedPxPerM: exPpm,
      relativeError: Math.abs(exPpm / ppm - 1),
      ...(strategy ? { strategy } : {}),
    },
    walls: {
      expected: truth.walls.length,
      detected: detectedWalls,
      extractedCount: extracted.walls.length,
      falsePositives: falseWalls,
      detectionRate: detectedWalls / Math.max(1, truth.walls.length),
      endpointErrorM: stats(endpointErr),
      kindCorrect,
      kindWrong,
      missed: missedWalls,
    },
    rooms: {
      expected: truth.rooms.length,
      matched: matched.length,
      meanIoU: stats(matched.map((p) => p.iou)).mean,
      minIoU:
        stats(matched.map((p) => p.iou)).median === undefined ? NaN : Math.min(...matched.map((p) => p.iou)),
      meanIoUAll: stats(perRoom.map((p) => p.iou)).mean,
      missed: perRoom.filter((p) => !p.matchedId).map((p) => p.id),
      labelsCorrect,
      perRoom,
    },
    doors: compareOpenings(truth, extracted, truth.doors, extracted.doors, ppm, true) as OpeningMetrics & {
      swingCorrect: number;
      hingedCompared: number;
    },
    windows: compareOpenings(truth, extracted, truth.windows, extracted.windows, ppm, false),
  };
}

const DIR: Record<PxDirection, PxPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function openingGeometry(ann: FloorPlanAnnotations, o: AnnotatedDoor | AnnotatedWindow) {
  const w = ann.walls.find((x) => x.id === o.wallId);
  if (!w) return null;
  const g = pxWallGeometry(w);
  const { from, to } = spanAlongWall(g, o.span);
  const c = (from + to) / 2;
  return { center: { x: g.a.x + g.dir.x * c, y: g.a.y + g.dir.y * c }, width: to - from, g };
}

function compareOpenings(
  truth: FloorPlanAnnotations,
  extracted: FloorPlanAnnotations,
  t: (AnnotatedDoor | AnnotatedWindow)[],
  e: (AnnotatedDoor | AnnotatedWindow)[],
  ppm: number,
  doors: boolean,
): OpeningMetrics & { swingCorrect?: number; hingedCompared?: number } {
  const used = new Set<string>();
  const pos: number[] = [];
  const width: number[] = [];
  const missed: string[] = [];
  let swingCorrect = 0;
  let hingedCompared = 0;
  for (const o of t) {
    const tg = openingGeometry(truth, o);
    if (!tg) continue;
    let best: {
      id: string;
      d: number;
      eg: NonNullable<ReturnType<typeof openingGeometry>>;
      eo: AnnotatedDoor | AnnotatedWindow;
    } | null = null;
    for (const x of e) {
      if (used.has(x.id)) continue;
      const eg = openingGeometry(extracted, x);
      if (!eg) continue;
      const d = dist(tg.center, eg.center) / ppm;
      if (d <= 0.6 && (!best || d < best.d)) best = { id: x.id, d, eg, eo: x };
    }
    if (!best) {
      missed.push(o.id);
      continue;
    }
    used.add(best.id);
    pos.push(best.d);
    width.push(Math.abs(best.eg.width - tg.width) / ppm);
    if (doors) {
      const td = o as AnnotatedDoor;
      const ed = best.eo as AnnotatedDoor;
      if (td.kind === 'hinged' && ed.kind === 'hinged') {
        hingedCompared++;
        // Same side of the wall and the same hinge jamb (compared in image space).
        const sameSide = DIR[td.swing].x * DIR[ed.swing].x + DIR[td.swing].y * DIR[ed.swing].y > 0;
        const hingePoint = (ann: FloorPlanAnnotations, d: AnnotatedDoor) => {
          const g = pxWallGeometry(ann.walls.find((w) => w.id === d.wallId)!);
          const { from, to } = spanAlongWall(g, d.span);
          const tt = d.hinge === 'min' ? from : to;
          return { x: g.a.x + g.dir.x * tt, y: g.a.y + g.dir.y * tt };
        };
        const sameHinge = dist(hingePoint(truth, td), hingePoint(extracted, ed)) / ppm < 0.25;
        if (sameSide && sameHinge) swingCorrect++;
      }
    }
  }
  return {
    expected: t.length,
    detected: t.length - missed.length,
    extractedCount: e.length,
    falsePositives: e.length - used.size,
    detectionRate: (t.length - missed.length) / Math.max(1, t.length),
    positionErrorM: stats(pos),
    widthErrorM: stats(width),
    missed,
    ...(doors ? { swingCorrect, hingedCompared } : {}),
  };
}

const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');

/** Plain-text report (used by the metrics script and the test log). */
export function formatMetrics(name: string, m: ExtractionMetrics): string {
  const s = (st: Stats) => `mean ${f(st.mean)} / median ${f(st.median)} / max ${f(st.max)} m (n=${st.n})`;
  return [
    `== ${name} ==`,
    `scale: truth ${f(m.scale.truthPxPerM, 2)} px/m, extracted ${f(m.scale.extractedPxPerM, 2)} px/m (${m.scale.strategy ?? 'none'}), error ${f(m.scale.relativeError * 100, 2)} %`,
    `walls: ${m.walls.detected}/${m.walls.expected} detected (${f(m.walls.detectionRate * 100, 1)} %), ${m.walls.extractedCount} extracted, ${m.walls.falsePositives} false; kind correct ${m.walls.kindCorrect}/${m.walls.detected}${m.walls.kindWrong.length ? ` [${m.walls.kindWrong.join(', ')}]` : ''}; endpoint error ${s(m.walls.endpointErrorM)}; missed [${m.walls.missed.join(', ')}]`,
    `rooms: ${m.rooms.matched}/${m.rooms.expected} matched (IoU ≥ 0.5), mean IoU ${f(m.rooms.meanIoU)} (all rooms ${f(m.rooms.meanIoUAll)}), min ${f(m.rooms.minIoU)}, labels correct ${m.rooms.labelsCorrect}; missed [${m.rooms.missed.join(', ')}]`,
    `doors: ${m.doors.detected}/${m.doors.expected} detected (${f(m.doors.detectionRate * 100, 1)} %), ${m.doors.falsePositives} false; position ${s(m.doors.positionErrorM)}; width ${s(m.doors.widthErrorM)}; swing+hinge correct ${m.doors.swingCorrect}/${m.doors.hingedCompared}; missed [${m.doors.missed.join(', ')}]`,
    `windows: ${m.windows.detected}/${m.windows.expected} detected (${f(m.windows.detectionRate * 100, 1)} %), ${m.windows.falsePositives} false; position ${s(m.windows.positionErrorM)}; width ${s(m.windows.widthErrorM)}; missed [${m.windows.missed.join(', ')}]`,
  ].join('\n');
}
