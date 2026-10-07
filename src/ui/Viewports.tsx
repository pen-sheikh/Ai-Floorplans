import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { nudgeFurniture } from '../app/actions';
import { FloorPlan2D } from '../plan2d/FloorPlan2D';
import { useDocument } from '../state/documentStore';
import { useScene } from '../state/sceneStore';
import { ArrowGlyph, IconMinus, IconPlus } from './icons';
import { Inspector } from './Inspector';

// three.js is split into its own chunk and only loaded when a 3D view is shown.
const ApartmentCanvas = lazy(() => import('../scene/ApartmentCanvas'));

const NUDGE = 0.05;

export function Viewports() {
  const viewMode = useScene((s) => s.viewMode);
  return (
    <section className={`viewports${viewMode === 'split' ? ' viewports--split' : ''}`} aria-label="Viewports">
      {viewMode !== '3d' && (
        <div className="viewport viewport--plan">
          <span className="viewport__label">2D floor plan</span>
          <FloorPlan2D />
        </div>
      )}
      {viewMode !== '2d' && <Viewport3D />}
      <Inspector />
    </section>
  );
}

function Viewport3D() {
  const validation = useDocument((s) => s.validation);
  const [override, setOverride] = useState(false);
  const zoom = useScene((s) => s.zoom);
  const selectedFurniture = useScene((s) => (s.selection?.kind === 'furniture' ? s.selection.id : null));
  const errors = validation.issues.filter((i) => i.severity === 'error');

  return (
    <div className="viewport">
      <span className="viewport__label">3D model</span>
      {errors.length > 0 && !override ? (
        <div className="validation-gate" role="alert">
          <div className="validation-gate__card">
            <h3 style={{ margin: 0 }}>The apartment model failed validation</h3>
            <p className="muted" style={{ margin: 0 }}>
              Rendering broken geometry would be misleading, so the 3D view is paused.
            </p>
            {errors.map((e, i) => (
              <div key={i} className="note note--error">
                {e.message}
              </div>
            ))}
            <button className="btn" onClick={() => setOverride(true)}>
              Render anyway (debug)
            </button>
          </div>
        </div>
      ) : (
        <WebGLBoundary>
          <Suspense fallback={<div className="validation-gate">Loading 3D…</div>}>
            <ApartmentCanvas />
          </Suspense>
        </WebGLBoundary>
      )}
      <div className="zoom-stack">
        <button className="zoom-btn" onClick={() => zoom(1)} aria-label="Zoom in">
          <IconPlus />
        </button>
        <button className="zoom-btn" onClick={() => zoom(-1)} aria-label="Zoom out">
          <IconMinus />
        </button>
      </div>
      {selectedFurniture && (
        <div className="nudge-pad" role="group" aria-label="Move selected furniture">
          <span />
          <button
            aria-label="Move up on plan"
            onClick={() => nudgeFurniture(selectedFurniture, { x: 0, z: -NUDGE })}
          >
            <ArrowGlyph dir="up" />
          </button>
          <span />
          <button
            aria-label="Move left"
            onClick={() => nudgeFurniture(selectedFurniture, { x: -NUDGE, z: 0 })}
          >
            <ArrowGlyph dir="left" />
          </button>
          <span className="nudge-pad__center">5 cm</span>
          <button
            aria-label="Move right"
            onClick={() => nudgeFurniture(selectedFurniture, { x: NUDGE, z: 0 })}
          >
            <ArrowGlyph dir="right" />
          </button>
          <span />
          <button
            aria-label="Move down on plan"
            onClick={() => nudgeFurniture(selectedFurniture, { x: 0, z: NUDGE })}
          >
            <ArrowGlyph dir="down" />
          </button>
          <span />
        </div>
      )}
    </div>
  );
}

class WebGLBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="validation-gate" role="alert">
          <div className="validation-gate__card">
            <h3 style={{ margin: 0 }}>3D view unavailable</h3>
            <p className="muted" style={{ margin: 0 }}>
              {this.state.error}. The 2D plan and all editing tools still work.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
