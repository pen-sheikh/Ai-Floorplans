import { useState } from 'react';
import {
  dispatchCommand,
  duplicateFurniture,
  nudgeWall,
  removeFurniture,
  renameRoom,
  rotateFurniture,
  transformFurniture,
  updateFurniture,
} from '../app/actions';
import { getCatalogItem } from '../catalog/furnitureCatalog';
import { effectiveColor, getMaterialDef, materialsFor } from '../catalog/materials';
import { polygonArea, wallLength } from '../domain/geometry';
import { roomMetrics, roomsBesideWall } from '../domain/topology';
import type { DoorKind, EntityKind, Floor, Provenance, WindowKind } from '../domain/types';
import { formatConfidence, formatMeasured, PROVENANCE_CLASS, PROVENANCE_HELP } from '../domain/provenance';
import { degToRad, formatArea, formatLength, normalizeAngle, radToDeg } from '../domain/units';
import { checkPlacement } from '../engine/placement';
import { selectFloor, useDocument } from '../state/documentStore';
import { useScene } from '../state/sceneStore';
import { useUi } from '../state/uiStore';
import { IconCopy, IconMinus, IconPlus, IconRotateCcw, IconRotateCw, IconTrash, IconX } from './icons';

/** Contextual information and editors for whatever is selected (2D or 3D). */
export function Inspector() {
  const selection = useScene((s) => s.selection);
  const select = useScene((s) => s.select);
  const floor = useDocument(selectFloor);
  const [collapsed, setCollapsed] = useState(false);
  if (!selection || selection.kind === 'apartment' || selection.kind === 'floor') return null;

  let body: React.ReactNode = null;
  let title = '';
  switch (selection.kind) {
    case 'room': {
      const room = floor.rooms.find((r) => r.id === selection.id);
      if (!room) return null;
      title = room.name;
      body = <RoomInfo floor={floor} roomId={room.id} />;
      break;
    }
    case 'wall':
      title = 'Wall';
      body = <WallInfo floor={floor} id={selection.id} />;
      break;
    case 'door':
      title = floor.doors.find((d) => d.id === selection.id)?.note ?? 'Door';
      body = <DoorInfo floor={floor} id={selection.id} />;
      break;
    case 'window':
      title = 'Window';
      body = <WindowInfo floor={floor} id={selection.id} />;
      break;
    case 'fixture': {
      const fx = floor.fixtures.find((f) => f.id === selection.id);
      if (!fx) return null;
      title = fx.label;
      body = (
        <>
          <dl className="kv">
            <dt>Type</dt>
            <dd>{fx.kind}</dd>
            <dt>Footprint</dt>
            <dd>{formatArea(polygonArea(fx.footprint))}</dd>
            <dt>Height</dt>
            <dd>{formatMeasured(fx.height, fx.sources.height)}</dd>
            <dt>Room</dt>
            <dd>{floor.rooms.find((r) => r.id === fx.roomId)?.name ?? '—'}</dd>
          </dl>
          {fx.note && <div className="note note--warning">{fx.note}</div>}
          <p className="muted small">Fixed object from the plan: furniture cannot overlap it.</p>
        </>
      );
      break;
    }
    case 'furniture': {
      const item = floor.furniture.find((f) => f.id === selection.id);
      if (!item) return null;
      title = item.name;
      body = <FurnitureInfo floor={floor} id={item.id} />;
      break;
    }
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector__head">
        <div>
          <div className="inspector__kind">{selection.kind}</div>
          <h3>{title}</h3>
        </div>
        <div className="row">
          <button
            className="close-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand inspector' : 'Collapse inspector'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <IconPlus size={14} /> : <IconMinus size={14} />}
          </button>
          <button className="close-btn" onClick={() => select(null)} aria-label="Close inspector">
            <IconX size={14} />
          </button>
        </div>
      </div>
      {!collapsed && body}
      {!collapsed && <EntityDetails floor={floor} kind={selection.kind} id={selection.id} />}
    </aside>
  );
}

function RoomInfo({ floor, roomId }: { floor: Floor; roomId: string }) {
  const room = floor.rooms.find((r) => r.id === roomId)!;
  const m = roomMetrics(room);
  const setCamera = useScene((s) => s.setCamera);
  const viewMode = useScene((s) => s.viewMode);
  const setViewMode = useScene((s) => s.setViewMode);
  const setTab = useUi((s) => s.setLeftTab);
  const items = floor.furniture.filter((f) => f.roomId === room.id);
  const r = room.renovation;
  return (
    <>
      <label className="field">
        <span>Name</span>
        <input
          key={room.name}
          className="input"
          defaultValue={room.name}
          onBlur={(e) => e.currentTarget.value !== room.name && renameRoom(room.id, e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      {room.labelSource === 'inferred' && (
        <div className="note note--warning">Not labelled on the plan — name inferred from the drawing.</div>
      )}
      {room.type === 'unknown' && (
        <div className="note note--warning">
          Room type unknown
          {room.classification?.suggestedType ? ` (perhaps ${room.classification.suggestedType})` : ''}. The
          space is still a valid room: rename it to set its type.
        </div>
      )}
      {room.labelSource === 'ocr' && (
        <div className="note">Name read from the plan automatically — check the spelling.</div>
      )}
      <dl className="kv">
        <dt>Area</dt>
        <dd>{formatArea(m.area)}</dd>
        <dt>Extents</dt>
        <dd>
          {formatLength(m.width, room.sources.geometry)} ×{' '}
          {formatLength(m.depth, room.sources.geometry).replace('≈ ', '')}
        </dd>
        {room.planLabel?.dimensionsText && (
          <>
            <dt>Printed on plan</dt>
            <dd>{room.planLabel.dimensionsText.split(' (')[0]}</dd>
          </>
        )}
        <dt>Ceiling</dt>
        <dd>
          {room.exterior ? 'open (outdoor)' : formatMeasured(room.ceilingHeight, room.sources.ceilingHeight)}
        </dd>
        <dt>Floor</dt>
        <dd>{getMaterialDef(r.floorMaterialId)?.name}</dd>
        <dt>Walls</dt>
        <dd>{getMaterialDef(r.wallMaterialId)?.name}</dd>
        <dt>Doors / windows</dt>
        <dd>
          {room.doorIds.length} / {room.windowIds.length}
        </dd>
      </dl>
      <div className="field">
        <span>Furniture ({items.length})</span>
        {items.length ? (
          <div className="chips">
            {items.map((f) => (
              <button
                key={f.id}
                className="chip"
                onClick={() => useScene.getState().select({ kind: 'furniture', id: f.id })}
              >
                {f.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            None yet.
          </p>
        )}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          className="btn btn--sm btn--dark"
          onClick={() => {
            if (viewMode === '2d') setViewMode('split');
            setCamera('room', room.id);
          }}
        >
          View inside
        </button>
        <button className="btn btn--sm" onClick={() => setTab('furniture')}>
          + Add furniture
        </button>
        <button className="btn btn--sm" onClick={() => setTab('renovate')}>
          Renovate
        </button>
      </div>
    </>
  );
}

function WallInfo({ floor, id }: { floor: Floor; id: string }) {
  const wall = floor.walls.find((w) => w.id === id);
  if (!wall) return null;
  const len = wallLength(wall);
  const [a, b] = roomsBesideWall(floor, wall, len / 2);
  const openings = [
    ...floor.doors.filter((d) => d.wallId === id),
    ...floor.windows.filter((w) => w.wallId === id),
  ];
  return (
    <>
      <dl className="kv">
        <dt>Type</dt>
        <dd>{wall.kind}</dd>
        <dt>Length</dt>
        <dd>{formatLength(len, wall.sources.geometry)}</dd>
        <dt>Thickness</dt>
        <dd>{formatLength(wall.thickness, wall.sources.geometry)}</dd>
        <dt>Height</dt>
        <dd>{formatMeasured(wall.height, wall.sources.height)}</dd>
        <dt>Sides</dt>
        <dd>{[a?.name ?? 'outside', b?.name ?? 'outside'].join(' | ')}</dd>
        <dt>Openings</dt>
        <dd>{openings.length}</dd>
      </dl>
      <p className="muted small">
        {wall.sources.geometry === 'user'
          ? 'Position corrected by you'
          : wall.sources.geometry === 'detected'
            ? 'Detected automatically in the plan image'
            : 'Length and thickness measured from the plan drawing'}{' '}
        (id <code>{wall.id}</code>).
      </p>
      {wall.kind === 'interior' && <WallMover id={id} towards={[a?.name, b?.name]} />}
    </>
  );
}

/**
 * Correct where an interior wall stands. Moves are along the wall's normal, towards one of the
 * rooms beside it; attached walls and room outlines follow, and the model is re-validated.
 */
function WallMover({ id, towards }: { id: string; towards: [string | undefined, string | undefined] }) {
  const [cm, setCm] = useState('5');
  const step = Number(cm.replace(',', '.')) / 100;
  const valid = Number.isFinite(step) && step > 0 && step <= 2;
  return (
    <div className="field">
      <span>Correct wall position</span>
      <div className="row small" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button
          className="btn btn--sm"
          disabled={!valid}
          onClick={() => nudgeWall(id, -step)}
          aria-label={`Move wall ${cm} cm towards ${towards[0] ?? 'the other side'}`}
        >
          ← {towards[0] ?? 'side A'}
        </button>
        <label className="row" style={{ gap: 4 }}>
          <input
            className="input"
            style={{ width: 64 }}
            inputMode="decimal"
            value={cm}
            onChange={(e) => setCm(e.target.value)}
            aria-label="Move step in centimetres"
          />
          cm
        </label>
        <button
          className="btn btn--sm"
          disabled={!valid}
          onClick={() => nudgeWall(id, step)}
          aria-label={`Move wall ${cm} cm towards ${towards[1] ?? 'the other side'}`}
        >
          {towards[1] ?? 'side B'} →
        </button>
      </div>
      <p className="muted small">
        Moves the wall sideways; walls ending on it and the rooms on both sides follow. Undo with Ctrl+Z.
      </p>
    </div>
  );
}

const DOOR_KINDS: DoorKind[] = ['hinged', 'double', 'sliding', 'bifold', 'opening'];
const WINDOW_KINDS: WindowKind[] = ['standard', 'large', 'sliding-door', 'balcony-door'];

function DoorInfo({ floor, id }: { floor: Floor; id: string }) {
  const door = floor.doors.find((d) => d.id === id);
  const toggle = useScene((s) => s.toggleDoor);
  const open = useScene((s) => s.openDoors[id] ?? true);
  if (!door) return null;
  const names = door.connects.map((c) => floor.rooms.find((r) => r.id === c)?.name ?? 'outside');
  return (
    <>
      <dl className="kv">
        <dt>Connects</dt>
        <dd>{names.join(' ↔ ')}</dd>
        <dt>Clear width</dt>
        <dd>{formatLength(door.width, door.sources.geometry)}</dd>
        <dt>Height</dt>
        <dd>{formatMeasured(door.height, door.sources.height)}</dd>
        <dt>Hinge / swing</dt>
        <dd>
          {door.kind === 'opening'
            ? '—'
            : `${door.hinge} jamb, swings into ${names[door.swingSide === 1 ? 1 : 0]}`}
        </dd>
      </dl>
      <label className="field">
        <span>Type</span>
        <select
          className="select"
          value={door.kind}
          onChange={(e) =>
            dispatchCommand({ type: 'door/update', id, patch: { kind: e.target.value as DoorKind } })
          }
        >
          {DOOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {door.kind !== 'opening' && (
        <div className="field">
          <span>Finish</span>
          <div className="chips">
            {materialsFor('door').map((m) => (
              <button
                key={m.id}
                className="swatch swatch--sm"
                style={{ background: m.color }}
                aria-pressed={door.materialId === m.id}
                title={m.name}
                aria-label={m.name}
                onClick={() => dispatchCommand({ type: 'door/update', id, patch: { materialId: m.id } })}
              />
            ))}
          </div>
        </div>
      )}
      {door.kind !== 'opening' && (
        <button className="btn btn--sm" onClick={() => toggle(id)}>
          {open ? 'Close door' : 'Open door'} (or double-click it)
        </button>
      )}
    </>
  );
}

function WindowInfo({ floor, id }: { floor: Floor; id: string }) {
  const win = floor.windows.find((w) => w.id === id);
  if (!win) return null;
  return (
    <>
      <dl className="kv">
        <dt>Width</dt>
        <dd>{formatLength(win.width, win.sources.geometry)}</dd>
        <dt>Height</dt>
        <dd>{formatMeasured(win.height, win.sources.height)}</dd>
        <dt>Sill / head</dt>
        <dd>
          {formatMeasured(win.sillHeight, win.sources.sillHeight)} /{' '}
          {(win.sillHeight + win.height).toFixed(2)} m
        </dd>
      </dl>
      <label className="field">
        <span>Type</span>
        <select
          className="select"
          value={win.kind}
          onChange={(e) =>
            dispatchCommand({ type: 'window/update', id, patch: { kind: e.target.value as WindowKind } })
          }
        >
          {WINDOW_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <NumField
        label="Sill height (m)"
        value={win.sillHeight}
        step={0.05}
        onCommit={(v) => dispatchCommand({ type: 'window/update', id, patch: { sillHeight: v } })}
      />
      <div className="field">
        <span>Frame</span>
        <div className="chips">
          {materialsFor('window').map((m) => (
            <button
              key={m.id}
              className="swatch swatch--sm"
              style={{ background: m.color }}
              aria-pressed={win.materialId === m.id}
              title={m.name}
              aria-label={m.name}
              onClick={() => dispatchCommand({ type: 'window/update', id, patch: { materialId: m.id } })}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function FurnitureInfo({ floor, id }: { floor: Floor; id: string }) {
  const item = floor.furniture.find((f) => f.id === id)!;
  const constraints = useScene((s) => s.constraints);
  const cat = getCatalogItem(item.catalogId);
  const report = checkPlacement(floor, item, constraints);
  const room = floor.rooms.find((r) => r.id === item.roomId);
  const d = item.dimensions;
  return (
    <>
      <div className="muted small">
        In {room?.name ?? '—'} · {cat?.name}
      </div>
      <div className="issues">
        {report.issues.length === 0 ? (
          <div className="note">
            <span className="badge badge--green">Fits</span> No collisions; clearances respected.
          </div>
        ) : (
          report.issues.map((i, k) => (
            <div key={k} className={`note ${i.severity === 'hard' ? 'note--error' : 'note--warning'}`}>
              {i.message}
            </div>
          ))
        )}
      </div>
      <div className="field">
        <span>Position (m)</span>
        <div className="num-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <NumField
            label="X"
            value={item.position.x}
            step={0.05}
            onCommit={(x) => transformFurniture(id, { position: { ...item.position, x } })}
          />
          <NumField
            label="Z"
            value={item.position.z}
            step={0.05}
            onCommit={(z) => transformFurniture(id, { position: { ...item.position, z } })}
          />
        </div>
      </div>
      <div className="field">
        <span>Rotation</span>
        <div className="row">
          <button
            className="btn btn--sm"
            onClick={() => rotateFurniture(id, -Math.PI / 2)}
            aria-label="Rotate 90° counter-clockwise"
          >
            <IconRotateCcw size={14} /> 90°
          </button>
          <button
            className="btn btn--sm"
            onClick={() => rotateFurniture(id, Math.PI / 12)}
            aria-label="Rotate 15°"
          >
            15°
          </button>
          <button
            className="btn btn--sm"
            onClick={() => rotateFurniture(id, Math.PI / 2)}
            aria-label="Rotate 90° clockwise"
          >
            <IconRotateCw size={14} /> 90°
          </button>
          <NumField
            label="deg"
            value={Math.round(radToDeg(normalizeAngle(item.rotation)))}
            step={5}
            onCommit={(deg) => transformFurniture(id, { rotation: degToRad(deg) })}
          />
        </div>
      </div>
      <div className="field">
        <span>Size (m)</span>
        <div className="num-row">
          <NumField
            label="Width"
            value={d.width}
            step={0.05}
            onCommit={(width) => transformFurniture(id, { dimensions: { ...d, width } })}
          />
          <NumField
            label="Depth"
            value={d.depth}
            step={0.05}
            onCommit={(depth) => transformFurniture(id, { dimensions: { ...d, depth } })}
          />
          <NumField
            label="Height"
            value={d.height}
            step={0.05}
            onCommit={(height) => transformFurniture(id, { dimensions: { ...d, height } })}
          />
        </div>
        {cat && (
          <span className="muted small">
            Range {cat.resize.min.width}–{cat.resize.max.width} × {cat.resize.min.depth}–
            {cat.resize.max.depth} m
          </span>
        )}
      </div>
      {cat && cat.materialOptions.length > 1 && (
        <div className="field">
          <span>Finish</span>
          <div className="chips">
            {cat.materialOptions.map((mid) => (
              <button
                key={mid}
                className="swatch swatch--sm"
                style={{ background: effectiveColor(mid) }}
                aria-pressed={item.materialId === mid && !item.color}
                title={getMaterialDef(mid)?.name}
                aria-label={getMaterialDef(mid)?.name}
                onClick={() => updateFurniture(id, { materialId: mid, color: undefined })}
              />
            ))}
            <input
              type="color"
              aria-label="Custom colour"
              value={item.color ?? effectiveColor(item.materialId)}
              onChange={(e) => updateFurniture(id, { color: e.target.value })}
            />
          </div>
        </div>
      )}
      <div className="row">
        <button className="btn btn--sm" onClick={() => duplicateFurniture(id)}>
          <IconCopy size={14} /> Duplicate
        </button>
        <button className="btn btn--sm btn--danger" onClick={() => removeFurniture(id)}>
          <IconTrash size={14} /> Delete
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Drag in 3D to move · R / Shift+R rotate · arrows nudge · Del removes · Ctrl+D duplicates
      </p>
    </>
  );
}

/** Numeric input that commits on Enter/blur (so typing doesn't spam the undo history). */
function NumField({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(2);
  const commit = (input: HTMLInputElement) => {
    const v = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(v) && Math.abs(v - value) > 1e-6) onCommit(v);
    // Accepted edits re-key the input with the new value; rejected ones fall back to the model value.
    input.value = shown;
  };
  return (
    <label>
      {label}
      <input
        key={shown}
        className="input"
        type="number"
        step={step}
        defaultValue={shown}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget)}
      />
    </label>
  );
}

/**
 * Developer-facing details for any selected entity: id, type, room, transform and where each
 * value came from. Built for debugging reconstruction ("is this height measured or assumed?").
 */
function EntityDetails({ floor, kind, id }: { floor: Floor; kind: EntityKind; id: string }) {
  const rows: [string, string][] = [['ID', id]];
  let sources: Partial<Record<string, Provenance>> | undefined;
  let confidence: number | undefined;
  const roomName = (rid: string | null | undefined) => floor.rooms.find((r) => r.id === rid)?.name ?? '—';
  switch (kind) {
    case 'room': {
      const r = floor.rooms.find((x) => x.id === id);
      if (!r) return null;
      rows.push(
        ['Type', r.type],
        ['Name source', PROVENANCE_CLASS[r.labelSource]],
        ['Geometry confidence', formatConfidence(r.geometryConfidence)],
        ['Label confidence', formatConfidence(r.labelConfidence)],
        ['Type confidence', formatConfidence(r.classificationConfidence)],
        ...(r.classification?.evidence.length
          ? ([['Type evidence', r.classification.evidence.join('; ')]] as [string, string][])
          : []),
        ['Vertices', String(r.polygon.length)],
      );
      ({ sources, confidence } = r);
      break;
    }
    case 'wall': {
      const w = floor.walls.find((x) => x.id === id);
      if (!w) return null;
      rows.push(
        ['Type', w.kind],
        ['Start', `${w.start.x.toFixed(2)}, ${w.start.z.toFixed(2)}`],
        ['End', `${w.end.x.toFixed(2)}, ${w.end.z.toFixed(2)}`],
      );
      ({ sources, confidence } = w);
      break;
    }
    case 'door': {
      const d = floor.doors.find((x) => x.id === id);
      if (!d) return null;
      rows.push(
        ['Type', d.kind],
        ['Wall', d.wallId],
        ['Offset on wall', `${d.offset.toFixed(2)} m`],
        ['Hinge / swing side', `${d.hinge} / ${d.swingSide > 0 ? '+n' : '−n'}`],
      );
      ({ sources, confidence } = d);
      break;
    }
    case 'window': {
      const w = floor.windows.find((x) => x.id === id);
      if (!w) return null;
      rows.push(['Type', w.kind], ['Wall', w.wallId], ['Offset on wall', `${w.offset.toFixed(2)} m`]);
      ({ sources, confidence } = w);
      break;
    }
    case 'fixture': {
      const f = floor.fixtures.find((x) => x.id === id);
      if (!f) return null;
      rows.push(['Type', f.kind], ['Room', roomName(f.roomId)], ['Vertices', String(f.footprint.length)]);
      ({ sources, confidence } = f);
      break;
    }
    case 'furniture': {
      const f = floor.furniture.find((x) => x.id === id);
      if (!f) return null;
      rows.push(
        ['Catalog', f.catalogId],
        ['Room', roomName(f.roomId)],
        ['Position', `${f.position.x.toFixed(2)}, ${f.position.z.toFixed(2)} m`],
        ['Rotation', `${Math.round(radToDeg(normalizeAngle(f.rotation)))}°`],
        [
          'Size',
          `${f.dimensions.width.toFixed(2)} × ${f.dimensions.depth.toFixed(2)} × ${f.dimensions.height.toFixed(2)} m`,
        ],
        ['Source', 'user placed'],
      );
      break;
    }
    default:
      return null;
  }
  return (
    <details className="details">
      <summary>Details</summary>
      <dl className="kv kv--small">
        {rows.map(([k, v]) => (
          <div key={k} className="kv__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {sources &&
          Object.entries(sources).map(([field, p]) => (
            <div key={field} className="kv__row">
              <dt>Source: {field}</dt>
              <dd title={PROVENANCE_HELP[PROVENANCE_CLASS[p!]]}>
                <span className={`badge badge--${PROVENANCE_CLASS[p!]}`}>{PROVENANCE_CLASS[p!]}</span>
              </dd>
            </div>
          ))}
        {kind !== 'furniture' && (
          <div className="kv__row">
            <dt>Confidence</dt>
            <dd>{formatConfidence(confidence)}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}
