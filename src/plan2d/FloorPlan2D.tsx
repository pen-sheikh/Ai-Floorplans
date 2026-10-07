import { useMemo, useRef, useState } from 'react';
import { planImageUrl } from '../assets/planImages';
import { planTransformOf, worldToPlan, type PlanTransform } from '../domain/coordinates';
import { pointAlongWall, polygonCentroid, wallFootprint } from '../domain/geometry';
import type { Floor, Vec2 } from '../domain/types';
import { checkPlacement, furnitureFootprint } from '../engine/placement';
import { selectFloor, useDocument } from '../state/documentStore';
import { useScene } from '../state/sceneStore';
import { IconMinus, IconPlus, IconPointer } from '../ui/icons';

const toPoints = (poly: Vec2[], t: PlanTransform) =>
  poly
    .map((p) => worldToPlan(p, t))
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

/**
 * The original floor plan with the reconstructed model drawn over it in plan pixels.
 * Selection and hover are shared with the 3D view through the scene store.
 */
export function FloorPlan2D() {
  const cs = useDocument((s) => s.apartment.coordinateSystem);
  const floor = useDocument(selectFloor);
  const constraints = useScene((s) => s.constraints);
  const selection = useScene((s) => s.selection);
  const hover = useScene((s) => s.hover);
  const select = useScene((s) => s.select);
  const setHover = useScene((s) => s.setHover);
  const setCamera = useScene((s) => s.setCamera);
  const viewMode = useScene((s) => s.viewMode);
  const setViewMode = useScene((s) => s.setViewMode);
  const t = planTransformOf(cs);
  const image = cs.plan?.image;
  const url = image ? planImageUrl(image.file) : undefined;

  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  /** "Click to room plan" pill, positioned when the pointer enters a room in this view. */
  const [pill, setPill] = useState<{ roomId: string; x: number; y: number } | null>(null);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const conflicts = useMemo(
    () => new Set(floor.furniture.filter((f) => checkPlacement(floor, f, constraints).hard).map((f) => f.id)),
    [floor, constraints],
  );

  if (!t || !image) {
    return (
      <p className="muted" style={{ padding: 20 }}>
        This model has no source plan image.
      </p>
    );
  }

  // Zoom 1 frames the apartment (not the whole sheet); zooming out reveals the full plan.
  const fit = fitRect(floor, t);
  const minZoom = Math.min(fit.w / image.widthPx, fit.h / image.heightPx);
  const w = fit.w / view.zoom;
  const h = fit.h / view.zoom;
  const vb = `${fit.x + fit.w / 2 - w / 2 + view.x} ${fit.y + fit.h / 2 - h / 2 + view.y} ${w} ${h}`;
  const zoomBy = (f: number) => {
    setPill(null);
    setView((v) => ({ ...v, zoom: Math.min(6, Math.max(minZoom, v.zoom * f)) }));
  };

  const pillRoom =
    pill && hover?.kind === 'room' && hover.id === pill.roomId
      ? floor.rooms.find((r) => r.id === pill.roomId)
      : undefined;

  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onMouseLeave={() => {
        setHover(null);
        setPill(null);
      }}
    >
      <svg
        ref={svgRef}
        className="plan-svg"
        viewBox={vb}
        role="img"
        aria-label="Floor plan with reconstructed rooms"
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || (e.target as Element).tagName === 'image') {
            pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            select(null);
          }
        }}
        onPointerMove={(e) => {
          if (!pan.current || !svgRef.current) return;
          setPill(null);
          const scale = w / svgRef.current.clientWidth;
          const p = pan.current;
          setView((v) => ({
            ...v,
            x: p.vx - (e.clientX - p.x) * scale,
            y: p.vy - (e.clientY - p.y) * scale,
          }));
        }}
        onPointerUp={() => (pan.current = null)}
      >
        {url && <image href={url} x={0} y={0} width={image.widthPx} height={image.heightPx} />}
        <PlanEntities floor={floor} t={t} />
        {floor.rooms.map((r) => {
          const selected = selection?.kind === 'room' && selection.id === r.id;
          return (
            <polygon
              key={r.id}
              data-room={r.id}
              className={`plan-room${selected ? ' plan-room--selected' : ''}${hover?.kind === 'room' && hover.id === r.id ? ' plan-room--hover' : ''}`}
              points={toPoints(r.polygon, t)}
              onPointerEnter={(e) => {
                setHover({ kind: 'room', id: r.id });
                const at = pillPosition(r.polygon, t, e.currentTarget.ownerSVGElement, vb);
                setPill(at ? { roomId: r.id, ...at } : null);
              }}
              onClick={(e) => {
                e.stopPropagation();
                select({ kind: 'room', id: r.id });
              }}
              onDoubleClick={() => {
                if (viewMode === '2d') setViewMode('split');
                setCamera('room', r.id);
              }}
            >
              <title>{r.name}</title>
            </polygon>
          );
        })}
        {floor.furniture.map((f) => {
          const sel = selection?.kind === 'furniture' && selection.id === f.id;
          return (
            <polygon
              key={f.id}
              className={`plan-furniture${sel ? ' plan-furniture--selected' : ''}${conflicts.has(f.id) ? ' plan-furniture--conflict' : ''}`}
              points={toPoints(furnitureFootprint(f), t)}
              onClick={(e) => {
                e.stopPropagation();
                select({ kind: 'furniture', id: f.id });
              }}
            >
              <title>{f.name}</title>
            </polygon>
          );
        })}
      </svg>
      {pill && pillRoom && (
        <button
          className="plan-pill"
          style={{ left: pill.x, top: pill.y }}
          onPointerEnter={() => setHover({ kind: 'room', id: pillRoom.id })}
          onClick={() => {
            select({ kind: 'room', id: pillRoom.id });
            if (viewMode === '2d') setViewMode('split');
            setCamera('room', pillRoom.id);
          }}
        >
          <IconPointer size={15} /> Click to room plan
        </button>
      )}
      <div className="zoom-stack">
        <button className="zoom-btn" onClick={() => zoomBy(1.3)} aria-label="Zoom in plan">
          <IconPlus />
        </button>
        <button className="zoom-btn" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out plan">
          <IconMinus />
        </button>
      </div>
    </div>
  );
}

/** Plan-pixel rectangle around the footprint and all rooms (incl. balcony), with a margin. */
function fitRect(floor: Floor, t: PlanTransform) {
  const pts = [...floor.footprint, ...floor.rooms.flatMap((r) => r.polygon)].map((p) => worldToPlan(p, t));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const m = 40;
  const x = Math.min(...xs) - m;
  const y = Math.min(...ys) - m;
  return { x, y, w: Math.max(...xs) + m - x, h: Math.max(...ys) + m - y };
}

/** Highlights for selected walls, doors, windows and fixtures, drawn in plan pixels. */
function PlanEntities({ floor, t }: { floor: Floor; t: PlanTransform }) {
  const selection = useScene((s) => s.selection);
  if (!selection) return null;
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));
  let poly: Vec2[] | null = null;
  if (selection.kind === 'wall') {
    const w = wallById.get(selection.id);
    if (w) poly = wallFootprint(w);
  } else if (selection.kind === 'door' || selection.kind === 'window') {
    const o =
      selection.kind === 'door'
        ? floor.doors.find((d) => d.id === selection.id)
        : floor.windows.find((d) => d.id === selection.id);
    const w = o ? wallById.get(o.wallId) : undefined;
    if (o && w) {
      const h = w.thickness / 2 + 0.05;
      poly = [
        pointAlongWall(w, o.offset - o.width / 2, -h),
        pointAlongWall(w, o.offset + o.width / 2, -h),
        pointAlongWall(w, o.offset + o.width / 2, h),
        pointAlongWall(w, o.offset - o.width / 2, h),
      ];
    }
  } else if (selection.kind === 'fixture') {
    poly = floor.fixtures.find((f) => f.id === selection.id)?.footprint ?? null;
  }
  return poly ? <polygon className="plan-highlight" points={toPoints(poly, t)} /> : null;
}

/** Screen position (relative to the SVG box) of a room's centroid, for the hover pill. */
function pillPosition(
  poly: Vec2[],
  t: PlanTransform,
  svg: SVGSVGElement | null,
  vb: string,
): { x: number; y: number } | null {
  if (!svg) return null;
  const [vx, vy, vw, vh] = vb.split(' ').map(Number) as [number, number, number, number];
  const c = worldToPlan(polygonCentroid(poly), t);
  const rect = svg.getBoundingClientRect();
  // preserveAspectRatio="xMidYMid meet": uniform scale, centred.
  const s = Math.min(rect.width / vw, rect.height / vh);
  const ox = (rect.width - vw * s) / 2;
  const oy = (rect.height - vh * s) / 2;
  return { x: ox + (c.x - vx) * s, y: oy + (c.y - vy) * s + 28 };
}
