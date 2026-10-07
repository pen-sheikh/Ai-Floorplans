import { useKeyboardShortcuts } from './app/useKeyboardShortcuts';
import { useUi } from './state/uiStore';
import { AssistantPanel } from './ui/AssistantPanel';
import { PlannerHeader, SiteHeader, Toolbar } from './ui/Chrome';
import { LeftPanel } from './ui/LeftPanel';
import { SaveDialog, Toasts } from './ui/Overlays';
import { Viewports } from './ui/Viewports';

export default function App() {
  useKeyboardShortcuts();
  const assistantOpen = useUi((s) => s.assistantOpen);
  return (
    <div className="app">
      <SiteHeader />
      <main className={`main${assistantOpen ? '' : ' main--assistant-closed'}`}>
        <section className="card planner" aria-label="Room planner">
          <PlannerHeader />
          <Toolbar />
          <div className="workspace">
            <LeftPanel />
            <Viewports />
          </div>
        </section>
        {assistantOpen && <AssistantPanel />}
      </main>
      <SaveDialog />
      <Toasts />
    </div>
  );
}
