import { create } from 'zustand';
import { applyCommand, describeCommand, type Command } from '../editor/commands';
import type { Apartment } from '../domain/types';
import { validateApartment, type ValidationContext, type ValidationResult } from '../domain/validation';
import { APP_VALIDATION, loadKnownPlan } from '../config/plans';

/**
 * Document store: the canonical apartment plus undo/redo history.
 * Three.js objects never live here — the scene reads from this store, not the other way round.
 */
export interface HistoryEntry {
  /** Snapshot BEFORE the change (structurally shared, so cheap). */
  apartment: Apartment;
  /** Validation of that snapshot, so undo/redo never re-validates. */
  validation: ValidationResult;
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
  /** The project as last loaded or saved; "Cancel" returns here. */
  baseline: Apartment;
  dispatch: (cmd: Command, opts?: { coalesceKey?: string }) => DispatchResult;
  endCoalesce: () => void;
  undo: () => void;
  redo: () => void;
  load: (apartment: Apartment) => void;
  /** Discard unsaved edits and return to the last loaded/saved project. */
  revertToBaseline: () => void;
  markSaved: () => void;
}

const HISTORY_LIMIT = 200;

/** Commands that can change geometry and therefore need re-validation. */
const touchesGeometry = (cmd: Command): boolean =>
  cmd.type === 'wall/move' ||
  cmd.type === 'door/update' ||
  cmd.type === 'window/update' ||
  (cmd.type === 'batch' && cmd.commands.some(touchesGeometry));

const errorCount = (v: ValidationResult) => v.issues.filter((i) => i.severity === 'error').length;

/**
 * Plan-agnostic store factory: give it any apartment. `ctx` lets validation check references
 * into the app's catalogs without the domain depending on them.
 */
export const createDocumentStore = (apartment: Apartment, ctx: ValidationContext = {}) =>
  create<DocumentState>()((set, get) => ({
    apartment,
    validation: validateApartment(apartment, ctx),
    past: [],
    future: [],
    coalesceKey: null,
    dirty: false,
    baseline: apartment,

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
        validation = validateApartment(next, ctx);
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
            {
              apartment: state.apartment,
              validation: state.validation,
              label: describeCommand(cmd),
              ...(key ? { coalesceKey: key } : {}),
            },
          ].slice(-HISTORY_LIMIT);
      set({ apartment: next, validation, past, future: [], coalesceKey: key ?? null, dirty: true });
      return { ok: true };
    },

    endCoalesce() {
      set({ coalesceKey: null });
    },

    undo() {
      const { past, future, apartment, validation } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({
        apartment: prev.apartment,
        validation: prev.validation,
        past: past.slice(0, -1),
        future: [{ apartment, validation, label: prev.label }, ...future],
        coalesceKey: null,
        dirty: true,
      });
    },

    redo() {
      const { past, future, apartment, validation } = get();
      const next = future[0];
      if (!next) return;
      set({
        apartment: next.apartment,
        validation: next.validation,
        past: [...past, { apartment, validation, label: next.label }],
        future: future.slice(1),
        coalesceKey: null,
        dirty: true,
      });
    },

    load(apt) {
      set({
        apartment: apt,
        validation: validateApartment(apt, ctx),
        past: [],
        future: [],
        coalesceKey: null,
        dirty: false,
        baseline: apt,
      });
    },

    revertToBaseline() {
      get().load(get().baseline);
    },

    markSaved() {
      set((s) => ({ dirty: false, baseline: s.apartment }));
    },
  }));

/** App singleton, bound to the configured default plan (see src/config/plans.ts). */
export const useDocument = createDocumentStore(loadKnownPlan(), APP_VALIDATION);

/** The active floor. This model has one floor per apartment today; multi-storey is supported by the schema. */
export const selectFloor = (s: DocumentState) => s.apartment.floors[0]!;
