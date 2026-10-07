import { create } from 'zustand';
import type { Command } from '../editor/commands';

export type LeftTab = 'furniture' | 'renovate' | 'model' | 'view';

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Structured intents produced for this message (shown for transparency). */
  intents?: unknown[];
  /** One-click follow-up offered by the assistant (e.g. "Add king-size bed"). */
  suggestion?: { label: string; command: Command };
}

/** UI-only state: panels, dialogs, notifications, chat transcript. */
export interface UiState {
  leftTab: LeftTab;
  furnitureQuery: string;
  saveDialog: 'closed' | 'saved';
  assistantOpen: boolean;
  toasts: Toast[];
  messages: ChatMessage[];
  setLeftTab: (t: LeftTab) => void;
  setFurnitureQuery: (q: string) => void;
  setSaveDialog: (v: UiState['saveDialog']) => void;
  setAssistantOpen: (v: boolean) => void;
  toast: (tone: Toast['tone'], message: string) => void;
  dismissToast: (id: number) => void;
  addMessage: (m: Omit<ChatMessage, 'id'>) => void;
}

let seq = 0;

export const useUi = create<UiState>()((set) => ({
  leftTab: 'furniture',
  furnitureQuery: '',
  saveDialog: 'closed',
  assistantOpen: true,
  toasts: [],
  messages: [
    {
      id: ++seq,
      role: 'assistant',
      text: 'Hi! I can place furniture, check whether something fits, or renovate a room. Try "Fit a sofa, TV unit and coffee table in the living room" or "Make bedroom 1 Scandinavian".',
    },
  ],
  setLeftTab: (leftTab) => set({ leftTab }),
  setFurnitureQuery: (furnitureQuery) => set({ furnitureQuery }),
  setSaveDialog: (saveDialog) => set({ saveDialog }),
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
  toast: (tone, message) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, { ...m, id: ++seq }] })),
}));
