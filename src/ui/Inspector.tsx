import { useState } from 'react';
import {
  dispatchCommand,
  duplicateFurniture,
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
import type { DoorKind, Floor, WindowKind } from '../domain/types';
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
            <dd>{formatLength(fx.height, 'assumed')} (assumed)</dd>
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
      <dl className="kv">
        <dt>Area</dt>
        <dd>{formatArea(m.area)}</dd>
        <dt>Extents</dt>
        <dd>
          {formatLength(m.width)} × {formatLength(m.depth).replace('≈ ', '')}
        </dd>
        {room.planLabel?.dimensionsText && (
          <>
            <dt>Printed on plan</dt>
            <dd>{room.planLabel.dimensionsText.split(' (')[0]}</dd>
          </>
        )}
        <dt>Ceiling</dt>
        <dd>
          {room.exterior ? 'open (outdoor)' : `${formatLength(room.ceilingHeight, 'assumed')} (assumed)`}
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
        <dd>{formatLength(len)}</dd>
        <dt>Thickness</dt>
        <dd>{formatLength(wall.thickness)}</dd>
        <dt>Height</dt>
        <dd>{formatLength(wall.height, 'assumed')} (assumed)</dd>
        <dt>Sides</dt>
        <dd>{[a?.name ?? 'outside', b?.name ?? 'outside'].join(' | ')}</dd>
        <dt>Openings</dt>
        <dd>{openings.length}</dd>
      </dl>
      <p className="muted small">
        Length and thickness measured from the plan drawing (id <code>{wall.id}</code>).
      </p>
    </>
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
        <dd>{formatLength(door.width)}</dd>
        <dt>Height</dt>
        <dd>{formatLength(door.height, 'assumed')} (assumed)</dd>
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
        <dd>{formatLength(win.width)}</dd>
        <dt>Height</dt>
        <dd>{formatLength(win.height, 'assumed')} (assumed)</dd>
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
