import { describe, expect, it } from 'vitest';
import type { FurnitureItem } from '../domain/types';
import { e2 } from '../test/fixtures';
import { createDocumentStore } from './documentStore';

const item: FurnitureItem = {
  id: 'chair',
  catalogId: 'armchair',
  name: 'Armchair',
  category: 'armchair',
  roomId: 'kitchen-living',
  position: { x: 8, z: 4 },
  elevation: 0,
  rotation: 0,
  dimensions: { width: 0.85, depth: 0.85, height: 0.85 },
  materialId: 'fabric-linen',
};

const furniture = (s: ReturnType<ReturnType<typeof createDocumentStore>['getState']>) =>
  s.apartment.floors[0]!.furniture;

describe('document store (undo/redo)', () => {
  it('undoes and redoes edits', () => {
    const store = createDocumentStore(e2());
    store.getState().dispatch({ type: 'furniture/add', item });
    store.getState().dispatch({ type: 'furniture/update', id: 'chair', patch: { rotation: 1 } });
    expect(store.getState().past.map((p) => p.label)).toEqual(['Add Armchair', 'Rotate furniture']);
    store.getState().undo();
    expect(furniture(store.getState())[0]!.rotation).toBe(0);
    store.getState().undo();
    expect(furniture(store.getState())).toHaveLength(0);
    store.getState().redo();
    store.getState().redo();
    expect(furniture(store.getState())[0]!.rotation).toBe(1);
    expect(store.getState().future).toHaveLength(0);
  });

  it('collapses a drag (same coalesce key) into one undo step', () => {
    const store = createDocumentStore(e2());
    store.getState().dispatch({ type: 'furniture/add', item });
    for (let i = 1; i <= 5; i++) {
      store
        .getState()
        .dispatch(
          { type: 'furniture/update', id: 'chair', patch: { position: { x: 8 + i * 0.1, z: 4 } } },
          { coalesceKey: 'drag' },
        );
    }
    store.getState().endCoalesce();
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    expect(furniture(store.getState())[0]!.position).toEqual({ x: 8, z: 4 });
  });

  it('rejects an edit that would make the model invalid, leaving history untouched', () => {
    const store = createDocumentStore(e2());
    const res = store.getState().dispatch({ type: 'door/update', id: 'd-bed1', patch: { width: 20 } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/beyond wall|overlaps/);
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().validation.ok).toBe(true);
  });

  it('reports command errors instead of throwing', () => {
    const store = createDocumentStore(e2());
    expect(store.getState().dispatch({ type: 'furniture/remove', id: 'ghost' }).ok).toBe(false);
  });

  it('tracks unsaved changes', () => {
    const store = createDocumentStore(e2());
    expect(store.getState().dirty).toBe(false);
    store.getState().dispatch({ type: 'room/renovate', roomId: 'hall', patch: { lighting: 'warm' } });
    expect(store.getState().dirty).toBe(true);
    store.getState().markSaved();
    expect(store.getState().dirty).toBe(false);
  });
});

describe('document store baseline (Cancel)', () => {
  it('reverts unsaved edits to the last loaded/saved project', () => {
    const store = createDocumentStore(e2());
    store.getState().dispatch({ type: 'furniture/add', item });
    store.getState().markSaved();
    store
      .getState()
      .dispatch({ type: 'room/renovate', roomId: 'hall', patch: { floorMaterialId: 'floor-stone' } });
    store.getState().revertToBaseline();
    const s = store.getState();
    expect(furniture(s)).toHaveLength(1); // saved state kept
    expect(s.apartment.floors[0]!.rooms.find((r) => r.id === 'hall')!.renovation.floorMaterialId).not.toBe(
      'floor-stone',
    );
    expect(s.dirty).toBe(false);
    expect(s.past).toHaveLength(0);
  });

  it('undo/redo restore the snapshot validation instead of recomputing it', () => {
    const store = createDocumentStore(e2());
    const before = store.getState().validation;
    store.getState().dispatch({ type: 'furniture/add', item });
    store.getState().undo();
    expect(store.getState().validation).toBe(before);
  });

  it('marks user-entered measurements as user-sourced', () => {
    const store = createDocumentStore(e2());
    store.getState().dispatch({ type: 'window/update', id: 'win-bed1', patch: { sillHeight: 0.8 } });
    expect(store.getState().apartment.floors[0]!.windows.find((w) => w.id === 'win-bed1')!.sources).toEqual({
      geometry: 'plan-geometry',
      sillHeight: 'user',
      height: 'assumed',
    });
  });
});
