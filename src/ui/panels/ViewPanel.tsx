import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_CONSTRAINTS, ISSUE_SEVERITY, type PlacementIssueCode } from '../../engine/constraints';
import { useScene, type DebugFlags, type OverlayPosition } from '../../state/sceneStore';

const FLAG_LABELS: Record<keyof DebugFlags, string> = {
  roomBoundaries: 'Room boundaries',
  wallCenterlines: 'Wall centrelines',
  wallBounds: 'Wall bounds / thickness',
  doorSwings: 'Door swing arcs',
  windows: 'Window positions',
  roomIds: 'Room IDs',
  dimensions: 'Wall lengths',
  furnitureBounds: 'Furniture bounds',
  collisionZones: 'Collision & clearance zones',
};

const HARD_CODES = (Object.keys(ISSUE_SEVERITY) as PlacementIssueCode[]).filter(
  (c) => ISSUE_SEVERITY[c] === 'hard',
);

export function ViewPanel() {
  const s = useScene(
    useShallow((x) => ({
      overlay: x.overlay,
      debug: x.debug,
      constraints: x.constraints,
      showFurniture: x.showFurniture,
      setOverlay: x.setOverlay,
      setDebugEnabled: x.setDebugEnabled,
      setDebugFlag: x.setDebugFlag,
      setConstraints: x.setConstraints,
    })),
  );
  const strict = HARD_CODES.every((c) => s.constraints.blocking.includes(c));
  const num = (key: 'walkingClearance' | 'doorClearance' | 'windowClearance', label: string) => (
    <label className="field">
      <span>
        {label}: {s.constraints[key].toFixed(2)} m
      </span>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.05}
        value={s.constraints[key]}
        onChange={(e) => s.setConstraints({ [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <>
      <div>
        <h2>View & rules</h2>
        <p className="muted small" style={{ margin: '2px 0 0' }}>
          Compare with the original plan and tune placement constraints.
        </p>
      </div>
      <div className="scroll">
        <section className="field">
          <span>Floor plan overlay (3D)</span>
          <label className="check">
            <input
              type="checkbox"
              checked={s.overlay.visible}
              onChange={(e) => s.setOverlay({ visible: e.target.checked })}
            />{' '}
            Show floor plan
          </label>
          <label className="field">
            <span>Opacity {Math.round(s.overlay.opacity * 100)} %</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={s.overlay.opacity}
              onChange={(e) => s.setOverlay({ opacity: Number(e.target.value), visible: true })}
            />
          </label>
          <select
            className="select"
            value={s.overlay.position}
            onChange={(e) => s.setOverlay({ position: e.target.value as OverlayPosition, visible: true })}
            aria-label="Overlay position"
          >
            <option value="floor">At floor level</option>
            <option value="above">Above the walls</option>
          </select>
        </section>

        <section className="field">
          <span>Debug / validation</span>
          <label className="check">
            <input
              type="checkbox"
              checked={s.debug.enabled}
              onChange={(e) => s.setDebugEnabled(e.target.checked)}
            />{' '}
            Debug mode
          </label>
          {(Object.keys(FLAG_LABELS) as (keyof DebugFlags)[]).map((k) => (
            <label key={k} className="check" style={{ opacity: s.debug.enabled ? 1 : 0.5 }}>
              <input
                type="checkbox"
                checked={s.debug.flags[k]}
                disabled={!s.debug.enabled}
                onChange={(e) => s.setDebugFlag(k, e.target.checked)}
              />{' '}
              {FLAG_LABELS[k]}
            </label>
          ))}
        </section>

        <section className="field">
          <span>Placement constraints</span>
          {num('walkingClearance', 'Walking clearance')}
          {num('doorClearance', 'Door clearance')}
          {num('windowClearance', 'Window clearance')}
          <label className="check">
            <input
              type="checkbox"
              checked={s.constraints.respectDoorSwings}
              onChange={(e) => s.setConstraints({ respectDoorSwings: e.target.checked })}
            />{' '}
            Keep door swings clear
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={strict}
              onChange={(e) =>
                s.setConstraints({
                  blocking: e.target.checked ? HARD_CODES : [...DEFAULT_CONSTRAINTS.blocking],
                })
              }
            />{' '}
            Strict: block all hard collisions while dragging
          </label>
          <button
            className="btn btn--sm"
            onClick={() =>
              s.setConstraints({ ...DEFAULT_CONSTRAINTS, blocking: [...DEFAULT_CONSTRAINTS.blocking] })
            }
          >
            Reset to defaults
          </button>
        </section>
      </div>
    </>
  );
}
