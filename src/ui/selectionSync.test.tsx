// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FloorPlan2D } from '../plan2d/FloorPlan2D';
import { useDocument } from '../state/documentStore';
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
