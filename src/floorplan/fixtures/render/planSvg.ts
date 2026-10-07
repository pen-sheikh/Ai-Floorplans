import type { AnnotatedWall, FloorPlanAnnotations, PxDirection, PxPoint } from '../../annotationTypes';

/**
 * Draw a floor plan image from ground-truth annotations, in a chosen drawing style. Used to
 * make test plans whose correct answer is known exactly: render → extract → compare with the
 * annotations that produced the image. Self-contained (type imports only) so the render script
 * can run under plain Node.
 */
export interface PlanStyle {
  wallFill: string;
  /** Outline around wall fill (some plans draw walls as outlined grey bands). */
  wallStroke?: string;
  lineColor: string;
  lineWidth: number;
  /** Door frames drawn as small boxes either side of the clear opening, this deep (px). */
  doorJambPx?: number;
  fontFamily: string;
  nameFontPx: number;
  dimFontPx: number;
  /** Upper-case room names ("BEDROOM") or as written. */
  upperCaseNames: boolean;
  /** Free text placed on the sheet (title, area, floor). */
  notes?: { text: string; at: PxPoint; fontPx?: number }[];
  /** Fixture outlines (kitchen counters…) drawn as thin lines, like real plans. */
  drawFixtures?: boolean;
}

export const DEFAULT_PLAN_STYLE: PlanStyle = {
  wallFill: '#111',
  lineColor: '#444',
  lineWidth: 1.4,
  fontFamily: 'Arial, Helvetica, sans-serif',
  nameFontPx: 15,
  dimFontPx: 13,
  upperCaseNames: true,
};

interface Seg {
  a: PxPoint;
  b: PxPoint;
  t: number;
  dir: PxPoint;
  n: PxPoint;
  len: number;
  dominant: 'x' | 'y';
}

function seg(w: AnnotatedWall): Seg {
  let a: PxPoint;
  let b: PxPoint;
  let t: number;
  if ('rect' in w) {
    const { x0, y0, x1, y1 } = w.rect;
    const horizontal = x1 - x0 >= y1 - y0;
    t = horizontal ? y1 - y0 : x1 - x0;
    a = horizontal ? { x: x0, y: (y0 + y1) / 2 } : { x: (x0 + x1) / 2, y: y0 };
    b = horizontal ? { x: x1, y: (y0 + y1) / 2 } : { x: (x0 + x1) / 2, y: y1 };
  } else {
    ({ a, b } = w.segment);
    t = w.segment.thicknessPx;
  }
  const dominant = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y';
  if ((dominant === 'x' ? b.x - a.x : b.y - a.y) < 0) [a, b] = [b, a];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  return { a, b, t, dir, n: { x: -dir.y, y: dir.x }, len, dominant };
}

const at = (s: Seg, along: number, side = 0): PxPoint => ({
  x: s.a.x + s.dir.x * along + s.n.x * side,
  y: s.a.y + s.dir.y * along + s.n.y * side,
});
const spanToAlong = (s: Seg, v: number) =>
  (v - (s.dominant === 'x' ? s.a.x : s.a.y)) / (s.dominant === 'x' ? s.dir.x : s.dir.y);
const f = (v: number) => +v.toFixed(2);
const pts = (ps: PxPoint[]) => ps.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const DIRV: Record<PxDirection, PxPoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function centroid(poly: PxPoint[]): PxPoint {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  return Math.abs(a) < 1e-9 ? poly[0]! : { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Drawing primitives in image pixels; serialised to SVG here, rasterised directly in tests. */
export type PlanPrimitive =
  | { kind: 'polygon'; points: PxPoint[]; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: 'line'; a: PxPoint; b: PxPoint; stroke: string; width: number }
  | { kind: 'arc'; center: PxPoint; r: number; from: PxPoint; to: PxPoint; stroke: string; width: number }
  | { kind: 'text'; at: PxPoint; text: string; size: number; bold?: boolean; rotateDeg?: number };

export function planPrimitives(
  ann: FloorPlanAnnotations,
  style: PlanStyle = DEFAULT_PLAN_STYLE,
): PlanPrimitive[] {
  const out: PlanPrimitive[] = [];
  const line = (a: PxPoint, b: PxPoint, width = style.lineWidth) =>
    out.push({ kind: 'line', a, b, stroke: style.lineColor, width });
  const segs = new Map(ann.walls.map((w) => [w.id, seg(w)]));

  // Walls (extended by half their thickness so corners close), then openings cut out of them.
  const kindOf = new Map(ann.walls.map((w) => [w.id, w.kind]));
  for (const [id, s] of segs) {
    const e = s.t / 2;
    if (kindOf.get(id) === 'railing') {
      // Railings: a hollow band (two thin parallel lines), drawn to the band's corners.
      for (const side of [-e, e]) line(at(s, -e, side), at(s, s.len + e, side));
      continue;
    }
    const quad = [at(s, -e, -e), at(s, s.len + e, -e), at(s, s.len + e, e), at(s, -e, e)];
    out.push({
      kind: 'polygon',
      points: quad,
      fill: style.wallFill,
      ...(style.wallStroke ? { stroke: style.wallStroke, strokeWidth: 1 } : {}),
    });
  }
  const cut = (s: Seg, from: number, to: number) => {
    // Wide enough to remove the outline stroke and its anti-aliasing too.
    const e = s.t / 2 + (style.wallStroke ? 1.5 : 0.6);
    out.push({
      kind: 'polygon',
      points: [at(s, from, -e), at(s, to, -e), at(s, to, e), at(s, from, e)],
      fill: '#fff',
    });
  };

  for (const w of ann.windows) {
    const s = segs.get(w.wallId)!;
    const [from, to] = w.span.map((v) => spanToAlong(s, v)).sort((p, q) => p - q) as [number, number];
    cut(s, from, to);
    const h = s.t / 2;
    for (const side of [-h, 0, h]) line(at(s, from, side), at(s, to, side));
    line(at(s, from, -h), at(s, from, h));
    line(at(s, to, -h), at(s, to, h));
  }

  for (const d of ann.doors) {
    const s = segs.get(d.wallId)!;
    const [from, to] = d.span.map((v) => spanToAlong(s, v)).sort((p, q) => p - q) as [number, number];
    const j = d.kind === 'opening' ? 0 : (style.doorJambPx ?? 0);
    cut(s, from - j, to + j);
    if (j > 0) {
      const h = s.t / 2;
      for (const [p, q] of [
        [from - j, from],
        [to, to + j],
      ] as const) {
        out.push({
          kind: 'polygon',
          points: [at(s, p, -h), at(s, q, -h), at(s, q, h), at(s, p, h)],
          stroke: style.lineColor,
          strokeWidth: style.lineWidth,
        });
      }
    }
    if (d.kind === 'opening') continue;
    const sv = DIRV[d.swing];
    const side = Math.sign(sv.x * s.n.x + sv.y * s.n.y) || 1;
    const face = (s.t / 2) * side;
    const leaf = (hingeAlong: number, otherAlong: number) => {
      const r = Math.abs(otherAlong - hingeAlong);
      const hinge = at(s, hingeAlong, face);
      const tip = { x: hinge.x + s.n.x * side * r, y: hinge.y + s.n.y * side * r };
      line(hinge, tip);
      // Quarter arc from the leaf tip back to the closing jamb.
      out.push({
        kind: 'arc',
        center: hinge,
        r,
        from: tip,
        to: at(s, otherAlong, face),
        stroke: style.lineColor,
        width: style.lineWidth,
      });
    };
    if (d.kind === 'double') {
      const mid = (from + to) / 2;
      leaf(from, mid);
      leaf(to, mid);
    } else {
      const hingeMin = d.hinge !== 'max';
      // 'min'/'max' refer to the dominant image axis; along-distances grow with it.
      leaf(hingeMin ? from : to, hingeMin ? to : from);
    }
  }

  if (style.drawFixtures) {
    for (const fx of ann.fixtures) {
      if ('polygon' in fx && fx.polygon)
        out.push({
          kind: 'polygon',
          points: fx.polygon,
          stroke: style.lineColor,
          strokeWidth: style.lineWidth,
        });
    }
  }

  // Printed dimension lines: line with end ticks, value centred above.
  for (const r of ann.calibration?.references ?? []) {
    if (!r.text || r.kind === 'reference' || !('a' in r)) continue;
    const dx = r.b.x - r.a.x;
    const dy = r.b.y - r.a.y;
    const L = Math.hypot(dx, dy);
    const nrm = { x: dy / L, y: -dx / L };
    line(r.a, r.b, 1);
    for (const p of [r.a, r.b])
      line({ x: p.x - nrm.x * 6, y: p.y - nrm.y * 6 }, { x: p.x + nrm.x * 6, y: p.y + nrm.y * 6 }, 1);
    const mid = { x: (r.a.x + r.b.x) / 2 + nrm.x * 6, y: (r.a.y + r.b.y) / 2 + nrm.y * 6 };
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    out.push({
      kind: 'text',
      at: mid,
      text: r.text,
      size: style.dimFontPx,
      rotateDeg: angle > 90 || angle < -90 ? angle + 180 : angle,
    });
  }

  // Room names (at their label, else the room centroid) with any printed dimensions below.
  const labelAt = new Map((ann.labels ?? []).map((l) => [l.id, l.at]));
  for (const room of ann.rooms) {
    if (room.labelSource !== 'plan-label') continue;
    const text = room.label?.text ?? room.name;
    const p = (room.labelId && labelAt.get(room.labelId)) || centroid(room.polygon);
    out.push({
      kind: 'text',
      at: p,
      text: style.upperCaseNames ? text.toUpperCase() : text,
      size: style.nameFontPx,
      bold: true,
    });
    if (room.label?.dimensionsText)
      out.push({
        kind: 'text',
        at: { x: p.x, y: p.y + style.dimFontPx * 1.4 },
        text: room.label.dimensionsText,
        size: style.dimFontPx,
      });
  }
  for (const n of style.notes ?? [])
    out.push({ kind: 'text', at: n.at, text: n.text, size: n.fontPx ?? style.dimFontPx });
  return out;
}

export function renderPlanSvg(ann: FloorPlanAnnotations, style: PlanStyle = DEFAULT_PLAN_STYLE): string {
  const { widthPx: W, heightPx: H } = ann.image;
  const svg = planPrimitives(ann, style).map((p) => {
    switch (p.kind) {
      case 'polygon':
        return `<polygon points="${pts(p.points)}" fill="${p.fill ?? 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.strokeWidth ?? 1}"` : ''}/>`;
      case 'line':
        return `<line x1="${f(p.a.x)}" y1="${f(p.a.y)}" x2="${f(p.b.x)}" y2="${f(p.b.y)}" stroke="${p.stroke}" stroke-width="${p.width}"/>`;
      case 'arc': {
        // Quarter arcs: the sweep direction follows from which side of centre→from the end lies.
        const cross =
          (p.from.x - p.center.x) * (p.to.y - p.center.y) - (p.from.y - p.center.y) * (p.to.x - p.center.x);
        return `<path d="M ${f(p.from.x)} ${f(p.from.y)} A ${f(p.r)} ${f(p.r)} 0 0 ${cross > 0 ? 1 : 0} ${f(p.to.x)} ${f(p.to.y)}" fill="none" stroke="${p.stroke}" stroke-width="${p.width}"/>`;
      }
      case 'text':
        return `<text x="${f(p.at.x)}" y="${f(p.at.y)}" font-size="${p.size}"${p.bold ? ' font-weight="bold"' : ''}${p.rotateDeg ? ` transform="rotate(${f(p.rotateDeg)} ${f(p.at.x)} ${f(p.at.y)})"` : ''}>${esc(p.text)}</text>`;
    }
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<g font-family="${style.fontFamily}" fill="#222" text-anchor="middle" dominant-baseline="middle">`,
    ...svg,
    '</g>',
    '</svg>',
  ].join('\n');
}
