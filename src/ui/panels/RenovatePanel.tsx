import { useState } from 'react';
import { applyPreset, renovateRoom } from '../../app/actions';
import { materialsFor, type MaterialUse } from '../../catalog/materials';
import { RENOVATION_PRESETS } from '../../catalog/renovationPresets';
import type { LightingPreset, Room, RoomRenovation } from '../../domain/types';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';

export function RenovatePanel() {
  const rooms = useDocument((s) => selectFloor(s).rooms);
  const selection = useScene((s) => s.selection);
  const [fallback, setFallback] = useState<string>('');
  const roomId =
    selection?.kind === 'room' ? selection.id : fallback || rooms.find((r) => r.type !== 'storage')?.id || '';
  const room = rooms.find((r) => r.id === roomId);

  return (
    <>
      <div>
        <h2>Renovate</h2>
        <p className="muted" style={{ margin: '2px 0 0' }}>
          Finishes change instantly; geometry is never touched.
        </p>
      </div>
      <label className="field">
        <span>Room</span>
        <select
          className="select"
          value={roomId}
          onChange={(e) => {
            setFallback(e.target.value);
            useScene.getState().select({ kind: 'room', id: e.target.value });
          }}
        >
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {room ? (
        <RoomFinishes room={room} allRoomIds={rooms.map((r) => r.id)} />
      ) : (
        <p className="muted">Select a room.</p>
      )}
    </>
  );
}

export function RoomFinishes({
  room,
  allRoomIds,
  compact = false,
}: {
  room: Room;
  allRoomIds?: string[];
  compact?: boolean;
}) {
  const r = room.renovation;
  const set = (patch: Partial<RoomRenovation>) => renovateRoom(room.id, patch);
  return (
    <div className="scroll">
      {!compact && (
        <section className="field">
          <span>Style presets</span>
          {RENOVATION_PRESETS.map((p) => (
            <button key={p.id} className="preset-card" onClick={() => applyPreset(p.id, [room.id])}>
              <strong>{p.name}</strong>
              <span className="muted small">{p.description}</span>
            </button>
          ))}
          {allRoomIds && (
            <div className="row">
              <span className="muted small">Apply a style to every room:</span>
              <select
                className="select"
                value=""
                onChange={(e) => e.target.value && applyPreset(e.target.value, allRoomIds)}
                aria-label="Apply style to all rooms"
              >
                <option value="">Choose…</option>
                {RENOVATION_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>
      )}
      <MaterialPicker
        label="Walls"
        use="wall"
        value={r.wallMaterialId}
        onChange={(id) => set({ wallMaterialId: id, wallColor: undefined })}
      />
      <div className="row">
        <label className="check">
          Wall colour
          <input
            type="color"
            value={r.wallColor ?? '#f4f3ef'}
            onChange={(e) => set({ wallColor: e.target.value })}
            aria-label="Custom wall colour"
          />
        </label>
        {r.wallColor && (
          <button className="btn btn--sm" onClick={() => set({ wallColor: undefined })}>
            Reset colour
          </button>
        )}
      </div>
      <MaterialPicker
        label="Floor"
        use="floor"
        value={r.floorMaterialId}
        onChange={(id) => set({ floorMaterialId: id, floorColor: undefined })}
      />
      {!room.exterior && (
        <MaterialPicker
          label="Ceiling"
          use="ceiling"
          value={r.ceilingMaterialId}
          onChange={(id) => set({ ceilingMaterialId: id, ceilingColor: undefined })}
        />
      )}
      {!compact && (
        <>
          <MaterialPicker
            label={`Doors (${room.doorIds.length})`}
            use="door"
            value={r.doorMaterialId}
            onChange={(id) => set({ doorMaterialId: id })}
          />
          {room.windowIds.length > 0 && (
            <MaterialPicker
              label={`Windows (${room.windowIds.length})`}
              use="window"
              value={r.windowMaterialId}
              onChange={(id) => set({ windowMaterialId: id })}
            />
          )}
        </>
      )}
      <div className="field">
        <span>Lighting</span>
        <div className="segmented segmented--sm" role="group" aria-label="Lighting">
          {(['warm', 'neutral', 'cool', 'off'] as LightingPreset[]).map((l) => (
            <button key={l} aria-pressed={r.lighting === l} onClick={() => set({ lighting: l })}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MaterialPicker({
  label,
  use,
  value,
  onChange,
}: {
  label: string;
  use: MaterialUse;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="material-grid" role="group" aria-label={label}>
        {materialsFor(use).map((m) => (
          <button
            key={m.id}
            className="material-tile"
            aria-pressed={value === m.id}
            onClick={() => onChange(m.id)}
            title={m.name}
          >
            <span className="material-tile__chip" style={{ background: m.color }} />
            {m.name}
          </button>
        ))}
      </div>
    </div>
  );
}
