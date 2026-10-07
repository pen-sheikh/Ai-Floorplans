import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { exportProject, importProjectFile, loadSavedProject, saveProject } from '../app/actions';
import { useDocument } from '../state/documentStore';
import { useScene, type CameraMode, type LightingMode, type ViewMode } from '../state/sceneStore';
import { useUi } from '../state/uiStore';
import {
  BrandMark,
  IconArrowLeft,
  IconBell,
  IconBug,
  IconBuilding,
  IconCamera,
  IconCeiling,
  IconChat,
  IconCube,
  IconDoor,
  IconDownload,
  IconHeart,
  IconLamp,
  IconLayers,
  IconMoon,
  IconPlan,
  IconRedo,
  IconReset,
  IconRuler,
  IconSearch,
  IconSplit,
  IconSun,
  IconTop,
  IconUndo,
  IconUpload,
} from './icons';

export function SiteHeader() {
  const assistantOpen = useUi((s) => s.assistantOpen);
  const setAssistantOpen = useUi((s) => s.setAssistantOpen);
  return (
    <header className="site-header">
      <a className="brand" href="#" aria-label="Property Scanner home">
        <span className="brand__mark">
          <BrandMark />
        </span>
        <span className="brand__name">
          <span>property</span>
          <span>scanner</span>
        </span>
      </a>
      <nav className="site-nav" aria-label="Main">
        <a href="#">Home</a>
        <a href="#">How It Works</a>
        <a href="#">Contact Us</a>
        <a href="#">FAQ</a>
      </nav>
      <div className="site-header__actions">
        <button className="icon-circle icon-circle--amber" aria-label="Search">
          <IconSearch />
        </button>
        <button className="icon-circle" aria-label="Notifications">
          <IconBell />
        </button>
        <button className="icon-circle" aria-label="Saved">
          <IconHeart />
        </button>
        <button
          className="icon-circle"
          aria-pressed={assistantOpen}
          aria-label="Toggle assistant"
          onClick={() => setAssistantOpen(!assistantOpen)}
        >
          <IconChat />
        </button>
        <span className="avatar" aria-hidden="true">
          PS
        </span>
      </div>
    </header>
  );
}

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: '2d', label: '2D Plan', icon: <IconPlan size={16} /> },
  { id: '3d', label: '3D', icon: <IconCube size={16} /> },
  { id: 'split', label: 'Split', icon: <IconSplit size={16} /> },
];

export function PlannerHeader() {
  const name = useDocument((s) => s.apartment.metadata.name);
  const building = useDocument((s) => s.apartment.metadata.building);
  const viewMode = useScene((s) => s.viewMode);
  const setViewMode = useScene((s) => s.setViewMode);
  return (
    <>
      <div className="crumbs">
        <button className="btn" onClick={() => history.back()}>
          <IconArrowLeft size={16} /> Back
        </button>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>Search Results</span>/<span>Room Planner</span>/<strong>{building ?? name}</strong>
        </nav>
      </div>
      <div className="planner__title">
        <div>
          <h1>Plan your apartment</h1>
          <p>Select a room on the plan or in 3D to add furniture and renovate it.</p>
        </div>
        <div className="segmented" role="group" aria-label="View mode">
          {VIEW_OPTIONS.map((o) => (
            <button key={o.id} aria-pressed={viewMode === o.id} onClick={() => setViewMode(o.id)}>
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

const CAMERA_OPTIONS: { id: CameraMode | 'reset'; label: string; icon: React.ReactNode }[] = [
  { id: 'perspective', label: 'Perspective', icon: <IconCamera size={16} /> },
  { id: 'top', label: 'Top', icon: <IconTop size={16} /> },
  { id: 'room', label: 'Inside room', icon: <IconDoor size={16} /> },
  { id: 'exterior', label: 'Exterior', icon: <IconBuilding size={16} /> },
  { id: 'reset', label: 'Reset', icon: <IconReset size={16} /> },
];

const LIGHT_OPTIONS: { id: LightingMode; label: string; icon: React.ReactNode }[] = [
  { id: 'day', label: 'Day', icon: <IconSun size={16} /> },
  { id: 'night', label: 'Night', icon: <IconMoon size={16} /> },
  { id: 'interior', label: 'Interior', icon: <IconLamp size={16} /> },
];

export function Toolbar() {
  // Narrow subscription: hover/drag updates must not re-render the toolbar.
  const scene = useScene(
    useShallow((s) => ({
      viewMode: s.viewMode,
      camera: s.camera,
      selection: s.selection,
      showCeilings: s.showCeilings,
      overlay: s.overlay,
      showDimensions: s.showDimensions,
      debug: s.debug,
      lighting: s.lighting,
      setCamera: s.setCamera,
      toggleCeilings: s.toggleCeilings,
      setOverlay: s.setOverlay,
      setShowDimensions: s.setShowDimensions,
      setDebugEnabled: s.setDebugEnabled,
      setLighting: s.setLighting,
    })),
  );
  const canUndo = useDocument((s) => s.past.length > 0);
  const canRedo = useDocument((s) => s.future.length > 0);
  const undoLabel = useDocument((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useDocument((s) => s.future[0]?.label);
  const dirty = useDocument((s) => s.dirty);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useUi((s) => s.toast);
  const show3d = scene.viewMode !== '2d';

  const camera = (id: CameraMode | 'reset') => {
    if (id === 'reset') return scene.setCamera('perspective');
    if (id === 'room') {
      const sel = scene.selection;
      if (sel?.kind !== 'room')
        return toast('info', 'Select a room first, then choose "Inside room" (or double-click a floor).');
      return scene.setCamera('room', sel.id);
    }
    scene.setCamera(id);
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Editor tools">
      {show3d && (
        <div className="toolbar__group" aria-label="Camera">
          {CAMERA_OPTIONS.map((o) => (
            <button
              key={o.id}
              className="tool"
              title={o.label}
              aria-pressed={o.id !== 'reset' && scene.camera.mode === o.id}
              onClick={() => camera(o.id)}
            >
              {o.icon}
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="toolbar__group" aria-label="Display">
        {show3d && (
          <button
            className="tool"
            aria-pressed={scene.showCeilings}
            onClick={scene.toggleCeilings}
            title="Show or hide ceilings"
          >
            <IconCeiling size={16} /> Ceilings
          </button>
        )}
        {show3d && (
          <button
            className="tool"
            aria-pressed={scene.overlay.visible}
            onClick={() => scene.setOverlay({ visible: !scene.overlay.visible })}
            title="Show the original plan in 3D"
          >
            <IconLayers size={16} /> Plan overlay
          </button>
        )}
        <button
          className="tool"
          aria-pressed={scene.showDimensions}
          onClick={() => scene.setShowDimensions(!scene.showDimensions)}
        >
          <IconRuler size={16} /> Dimensions
        </button>
        <button
          className="tool"
          aria-pressed={scene.debug.enabled}
          onClick={() => scene.setDebugEnabled(!scene.debug.enabled)}
          title="Geometry validation overlays"
        >
          <IconBug size={16} /> Debug
        </button>
      </div>
      {show3d && (
        <div className="toolbar__group" aria-label="Lighting">
          {LIGHT_OPTIONS.map((o) => (
            <button
              key={o.id}
              className="tool"
              aria-pressed={scene.lighting === o.id}
              onClick={() => scene.setLighting(o.id)}
              title={`${o.label} lighting`}
            >
              {o.icon}
              <span className="sr-only">{o.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="toolbar__group" aria-label="History">
        <button
          className="tool"
          disabled={!canUndo}
          onClick={() => useDocument.getState().undo()}
          title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo'}
        >
          <IconUndo size={16} /> Undo
        </button>
        <button
          className="tool"
          disabled={!canRedo}
          onClick={() => useDocument.getState().redo()}
          title={redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : 'Redo'}
        >
          <IconRedo size={16} /> Redo
        </button>
      </div>
      <div className="toolbar__group" aria-label="Project">
        <button className="tool" onClick={() => void saveProject()} title="Save to this browser (Ctrl+S)">
          Save{dirty ? ' •' : ''}
        </button>
        <button className="tool" onClick={() => void loadSavedProject()} title="Load the last saved project">
          Load
        </button>
        <button className="tool" onClick={exportProject} title="Download project JSON">
          <IconDownload size={16} /> Export
        </button>
        <button className="tool" onClick={() => fileRef.current?.click()} title="Import project JSON">
          <IconUpload size={16} /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importProjectFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
