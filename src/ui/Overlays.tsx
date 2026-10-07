import { exportProject } from '../app/actions';
import { useUi } from '../state/uiStore';
import { IconCheck, IconX } from './icons';

export function SaveDialog() {
  const state = useUi((s) => s.saveDialog);
  const setState = useUi((s) => s.setSaveDialog);
  if (state === 'closed') return null;
  const close = () => setState('closed');
  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close-btn" onClick={close} aria-label="Close">
          <IconX size={14} />
        </button>
        <div className="success-mark">
          <span>
            <IconCheck size={34} stroke="#fff" strokeWidth={3} />
          </span>
        </div>
        <h2 id="save-title">Room plan saved!</h2>
        <p className="muted" style={{ margin: 0 }}>
          Your room plan has been saved successfully.
        </p>
        <button className="btn btn--primary btn--lg" style={{ width: '100%' }} onClick={close}>
          Back to Home
        </button>
        <button className="btn btn--sm" onClick={exportProject}>
          Download project JSON
        </button>
        <p className="muted small" style={{ margin: 0 }}>
          You can find this design anytime under Saved page.
        </p>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`} role="status" onClick={() => dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
