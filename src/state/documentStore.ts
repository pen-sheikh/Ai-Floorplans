import { create } from 'zustand';
import { applyCommand, describeCommand, type Command } from '../editor/commands';
import type { Apartment } from '../domain/types';
import { validateApartment, type ValidationResult } from '../domain/validation';
import { loadApartmentFromPlan } from '../floorplan';

/**
 * Document store: the canonical apartment plus undo/redo history.
 * Three.js objects never live here — the scene reads from this store, not the other way round.
 */
export interface HistoryEntry {
  /** Snapshot BEFORE the change (structurally shared, so cheap). */
  apartment: Apartment;
  label: string;
  coalesceKey?: string;
}

export interface DispatchResult {
  ok: boolean;
  error?: string;
}

export interface DocumentState {
  apartment: Apartment;
  validation: ValidationResult;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Consecutive commands with the same key (e.g. one drag) collapse into one undo step. */
  coalesceKey: string | null;
  /** Changes since the last save. */
  dirty: boolean;
  dispatch: (cmd: Command, opts?: { coalesceKey?: string }) => DispatchResult;
  endCoalesce: () => void;
  undo: () => void;
  redo: () => void;
  load: (apartment: Apartment) => void;
  markSaved: () => void;
}

const HISTORY_LIMIT = 200;

/** Commands that can change geometry and therefore need re-validation. */
const touchesGeometry = (cmd: Command): boolean =>
  cmd.type === 'door/update' ||
  cmd.type === 'window/update' ||
  (cmd.type === 'batch' && cmd.commands.some(touchesGeometry));

const errorCount = (v: ValidationResult) => v.issues.filter((i) => i.severity === 'error').length;

function initialApartment(): Apartment {
  return loadApartmentFromPlan();
}

export const createDocumentStore = (apartment: Apartment = initialApartment()) =>
  create<DocumentState>()((set, get) => ({
    apartment,
    validation: validateApartment(apartment),
    past: [],
    future: [],
    coalesceKey: null,
    dirty: false,

    dispatch(cmd, opts) {
      const state = get();
      let next: Apartment;
      try {
        next = applyCommand(state.apartment, cmd);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      let validation = state.validation;
      if (touchesGeometry(cmd)) {
        validation = validateApartment(next);
        if (errorCount(validation) > errorCount(state.validation)) {
          const first = validation.issues.find((i) => i.severity === 'error');
          return { ok: false, error: first?.message ?? 'Change would make the model invalid.' };
        }
      }
      const key = opts?.coalesceKey;
      const coalesce = key !== undefined && key === state.coalesceKey && state.past.length > 0;
      const past = coalesce
        ? state.past
        : [
            ...state.past,
            { apartment: state.apartment, label: describeCommand(cmd), ...(key ? { coalesceKey: key } : {}) },
          ].slice(-HISTORY_LIMIT);
      set({ apartment: next, validation, past, future: [], coalesceKey: key ?? null, dirty: true });
      return { ok: true };
    },

    endCoalesce() {
      set({ coalesceKey: null });
    },

    undo() {
      const { past, future, apartment } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({
        apartment: prev.apartment,
        validation: validateApartment(prev.apartment),
        past: past.slice(0, -1),
        future: [{ apartment, label: prev.label }, ...future],
        coalesceKey: null,
        dirty: true,
      });
    },

    redo() {
      const { past, future, apartment } = get();
      const next = future[0];
      if (!next) return;
      set({
        apartment: next.apartment,
        validation: validateApartment(next.apartment),
        past: [...past, { apartment, label: next.label }],
        future: future.slice(1),
        coalesceKey: null,
        dirty: true,
      });
    },

    load(apt) {
      set({
        apartment: apt,
        validation: validateApartment(apt),
        past: [],
        future: [],
        coalesceKey: null,
        dirty: false,
      });
    },

    markSaved() {
      set({ dirty: false });
    },
  }));

export const useDocument = createDocumentStore();

/** The active floor. This model has one floor per apartment today; multi-storey is supported by the schema. */
export const selectFloor = (s: DocumentState) => s.apartment.floors[0]!;
