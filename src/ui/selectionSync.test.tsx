// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planTransformOf, worldToPlan } from '../domain/coordinates';
import { FloorPlan2D } from '../plan2d/FloorPlan2D';
import { openingSpans, pieceTransform, wallPieces } from '../scene/builders/wallPieces';
import { selectFloor, useDocument } from '../state/documentStore';
import { useScene } from '../state/sceneStore';
import { Inspector } from './Inspector';

/**
 * The 2D plan and the 3D scene never talk to each other directly: both read and write the
 * selection in the scene store. Selecting in one view is therefore visible in the other.
 */
describe('2D ↔ 3D selection sync', () => {
  beforeEach(() => act(() => useScene.getState().select(null)));
  afterEach(cleanup);

  it('selecting a room on the 2D plan selects it for the 3D view and the inspector', () => {
    const { container } = render(
      <>
        <FloorPlan2D />
        <Inspector />
      </>,
    );
    const bathroom = container.querySelector('polygon[data-room="bathroom"]')!;
    fireEvent.click(bathroom);
    expect(useScene.getState().selection).toEqual({ kind: 'room', id: 'bathroom' });
    expect(bathroom.getAttribute('class')).toContain('plan-room--selected');
    expect(screen.getByRole('heading', { name: 'Bathroom' })).toBeTruthy();
    expect(screen.getByText('1.70m x 2.31m')).toBeTruthy();
  });

  it('a selection made in 3D (via the store) highlights the room on the plan', () => {
    const { container } = render(<FloorPlan2D />);
    act(() => useScene.getState().select({ kind: 'room', id: 'kitchen-living' }));
    expect(container.querySelector('polygon[data-room="kitchen-living"]')!.getAttribute('class')).toContain(
      'plan-room--selected',
    );
    expect(container.querySelector('polygon[data-room="bathroom"]')!.getAttribute('class')).not.toContain(
      'selected',
    );
  });

  it('draws the original plan image under the reconstructed rooms', () => {
    const { container } = render(<FloorPlan2D />);
    expect(container.querySelector('image')!.getAttribute('href')).toMatch(/E2-floorplan\.jpg/);
    expect(container.querySelectorAll('polygon[data-room]').length).toBe(10);
  });
});

describe('model edits reach the 2D view', () => {
  afterEach(cleanup);

  it('shows furniture added through a command, and removes it on undo', () => {
    const { container } = render(<FloorPlan2D />);
    const count = () => container.querySelectorAll('polygon.plan-furniture').length;
    const before = count();
    act(() => {
      useDocument.getState().dispatch({
        type: 'furniture/add',
        item: {
          id: 'sync-test-chair',
          catalogId: 'armchair',
          name: 'Armchair',
          category: 'armchair',
          roomId: 'kitchen-living',
          position: { x: 8, z: 4 },
          elevation: 0,
          rotation: 0,
          dimensions: { width: 0.85, depth: 0.85, height: 0.85 },
          materialId: 'fabric-linen',
        },
      });
    });
    expect(count()).toBe(before + 1);
    act(() => useDocument.getState().undo());
    expect(count()).toBe(before);
  });

  it('rooms on the plan are keyboard-selectable', () => {
    const { container } = render(<FloorPlan2D />);
    const hall = container.querySelector('polygon[data-room="hall"]')!;
    expect(hall.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(hall, { key: 'Enter' });
    expect(useScene.getState().selection).toEqual({ kind: 'room', id: 'hall' });
  });
});

describe('correcting a wall position (Phase 5): one model, both views', () => {
  afterEach(cleanup);

  it('selects a wall on the plan, moves it from the inspector, and both views read the new geometry', () => {
    const { container } = render(
      <>
        <FloorPlan2D />
        <Inspector />
      </>,
    );
    const id = 'w-int-bed1-bed2';
    const doc = () => useDocument.getState();
    const wall = () => selectFloor(doc()).walls.find((w) => w.id === id)!;
    const before = wall();
    const room = () => container.querySelector('polygon[data-room="bedroom-1"]')!.getAttribute('points');
    const roomBefore = room();

    // 2D selection is the shared selection the 3D view reads.
    fireEvent.click(container.querySelector(`polygon[data-wall="${id}"]`)!);
    expect(useScene.getState().selection).toEqual({ kind: 'wall', id });
    fireEvent.click(screen.getByRole('button', { name: 'Move wall 5 cm towards Bedroom 1' }));

    // The canonical model changed: the wall moved 5 cm towards Bedroom 1 (its +n side) and is user-corrected.
    const after = wall();
    expect(after.sources.geometry).toBe('user');
    expect(Math.hypot(after.start.x - before.start.x, after.start.z - before.start.z)).toBeCloseTo(0.05, 9);

    // 2D: the room outline is redrawn from the model, and the corrected wall is marked.
    expect(room()).not.toBe(roomBefore);
    const t = planTransformOf(doc().apartment.coordinateSystem)!;
    const expected = selectFloor(doc())
      .rooms.find((r) => r.id === 'bedroom-1')!
      .polygon.map((p) => worldToPlan(p, t))
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    expect(room()).toBe(expected);
    expect(container.querySelector(`polygon[data-wall="${id}"]`)!.getAttribute('class')).toContain(
      'plan-wall--user',
    );

    // 3D: the wall meshes are built from the same model, so they stand on the new centreline.
    const f = selectFloor(doc());
    const centres = wallPieces(after, openingSpans(after, f.doors, f.windows)).map(
      (p) => pieceTransform(after, p).center,
    );
    for (const c of centres) expect(c.x).toBeCloseTo(after.start.x, 9);

    // Undo restores both views' input.
    act(() => doc().undo());
    expect(wall()).toEqual(before);
    expect(room()).toBe(roomBefore);
  });

  it('shows the wall correction controls only for interior walls', () => {
    render(<Inspector />);
    act(() => useScene.getState().select({ kind: 'wall', id: 'w-ext-north' }));
    expect(screen.queryByText('Correct wall position')).toBeNull();
    act(() => useScene.getState().select({ kind: 'wall', id: 'w-int-bed1-bed2' }));
    expect(screen.getByText('Correct wall position')).toBeTruthy();
  });
});
