import { useEffect } from 'react';
import { useDocument } from '../state/documentStore';
import { useScene } from '../state/sceneStore';
import { duplicateFurniture, nudgeFurniture, removeFurniture, rotateFurniture, saveProject } from './actions';

const NUDGE = 0.05;
const ROTATE = Math.PI / 12;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Global editor shortcuts. Ignored while typing in form fields. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const doc = useDocument.getState();
      const scene = useScene.getState();
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doc.redo();
        else doc.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        doc.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProject();
        return;
      }
      if (e.key === 'Escape') {
        scene.select(null);
        return;
      }
      const sel = scene.selection;
      if (sel?.kind !== 'furniture') return;
      const id = sel.id;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeFurniture(id);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateFurniture(id);
      } else if (e.key.toLowerCase() === 'r') {
        rotateFurniture(id, e.shiftKey ? -ROTATE : ROTATE);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE / 5 : NUDGE;
        const d = {
          ArrowUp: { x: 0, z: -step },
          ArrowDown: { x: 0, z: step },
          ArrowLeft: { x: -step, z: 0 },
          ArrowRight: { x: step, z: 0 },
        }[e.key];
        if (d) nudgeFurniture(id, d);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) useDocument.getState().endCoalesce();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}
