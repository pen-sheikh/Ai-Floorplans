import { saveProject } from '../app/actions';
import { loadApartmentFromPlan } from '../floorplan';
import { useDocument } from '../state/documentStore';
import { useScene } from '../state/sceneStore';
import { useUi, type LeftTab } from '../state/uiStore';
import { FurniturePanel } from './panels/FurniturePanel';
import { ModelPanel } from './panels/ModelPanel';
import { RenovatePanel } from './panels/RenovatePanel';
import { ViewPanel } from './panels/ViewPanel';

const TABS: { id: LeftTab; label: string }[] = [
  { id: 'furniture', label: 'Furniture' },
  { id: 'renovate', label: 'Renovate' },
  { id: 'model', label: 'Model' },
  { id: 'view', label: 'View' },
];

export function LeftPanel() {
  const tab = useUi((s) => s.leftTab);
  const setTab = useUi((s) => s.setLeftTab);
  const dirty = useDocument((s) => s.dirty);

  const cancel = () => {
    if (dirty && !window.confirm('Discard unsaved changes and start again from the floor plan?')) return;
    useDocument.getState().load(loadApartmentFromPlan());
    useScene.getState().select(null);
  };

  return (
    <aside className="side-panel" aria-label="Planner tools">
      <div className="side-panel__body">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'furniture' && <FurniturePanel />}
        {tab === 'renovate' && <RenovatePanel />}
        {tab === 'model' && <ModelPanel />}
        {tab === 'view' && <ViewPanel />}
      </div>
      <div className="side-panel__actions">
        <button className="btn btn--lg" onClick={cancel}>
          Cancel
        </button>
        <button className="btn btn--primary btn--lg" onClick={() => void saveProject()}>
          Save this
        </button>
      </div>
    </aside>
  );
}
