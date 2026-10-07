import { useEffect, useRef, useState } from 'react';
import { askAssistant, dispatchCommand } from '../app/actions';
import { useUi } from '../state/uiStore';
import { IconSend, IconX } from './icons';

const EXAMPLES = [
  'Put a 3-seat sofa against the longest wall in the living room',
  'Fit a TV unit and coffee table in the living room',
  'Can I fit a king-size bed in bedroom 1?',
  'Renovate bedroom 2 with warm wood flooring and light beige walls',
  'Make the bathroom marble floor',
  'Make bedroom 1 Scandinavian',
];

/**
 * Natural-language control. Text → structured intent (shown under each reply) →
 * deterministic engine → model update. The assistant never touches the 3D scene directly.
 */
export function AssistantPanel() {
  const messages = useUi((s) => s.messages);
  const setOpen = useUi((s) => s.setAssistantOpen);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const send = async (value: string) => {
    const v = value.trim();
    if (!v || busy) return;
    setText('');
    setBusy(true);
    try {
      await askAssistant(v);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="card assistant assistant-dock" aria-label="Assistant">
      <div className="assistant__head">
        <strong>Assistant</strong>
        <button className="close-btn" onClick={() => setOpen(false)} aria-label="Close assistant">
          <IconX size={14} />
        </button>
      </div>
      <div className="assistant__messages" ref={listRef} aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`msg msg--${m.role}`}>
            <span className="msg__avatar" aria-hidden="true">
              {m.role === 'assistant' ? 'P' : 'Y'}
            </span>
            <div className="msg__bubble">
              {m.text}
              {m.suggestion && (
                <div style={{ marginTop: 8 }}>
                  <button
                    className="btn btn--sm btn--primary"
                    onClick={() => dispatchCommand(m.suggestion!.command)}
                  >
                    {m.suggestion.label}
                  </button>
                </div>
              )}
              {m.intents && m.intents.length > 0 && (
                <details>
                  <summary>Structured intent</summary>
                  <pre>{JSON.stringify(m.intents, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>
      {messages.length <= 1 && (
        <div className="chips" aria-label="Examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => void send(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask to place furniture or renovate…"
          aria-label="Message"
        />
        <button className="composer__send" type="submit" disabled={busy} aria-label="Send">
          <IconSend size={16} />
        </button>
      </form>
    </aside>
  );
}
