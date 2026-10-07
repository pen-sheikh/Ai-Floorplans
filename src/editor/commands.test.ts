import { describe, expect, it } from 'vitest';
import type { FurnitureItem } from '../domain/types';
import { e2 } from '../test/fixtures';
import { applyCommand, CommandError, describeCommand } from './commands';

const sofa: FurnitureItem = {
  id: 'sofa-1',
  catalogId: 'sofa-3',
  name: '3-seat sofa',
  category: 'sofa',
  roomId: 'kitchen-living',
  position: { x: 8.6, z: 4 },
  elevation: 0,
  rotation: 0,
  dimensions: { width: 2.2, depth: 0.9, height: 0.85 },
  materialId: 'fabric-linen',
};

describe('editing commands', () => {
  it('adds, moves, rotates, resizes and removes furniture immutably', () => {
    const a0 = e2();
    const a1 = applyCommand(a0, { type: 'furniture/add', item: sofa });
    expect(a0.floors[0]!.furniture).toHaveLength(0);
    expect(a1.floors[0]!.furniture).toEqual([sofa]);

    const a2 = applyCommand(a1, {
      type: 'furniture/update',
      id: sofa.id,
      patch: { position: { x: 9, z: 5 }, rotation: 1 },
    });
    expect(a2.floors[0]!.furniture[0]).toMatchObject({ position: { x: 9, z: 5 }, rotation: 1 });
    expect(a1.floors[0]!.furniture[0]!.position).toEqual({ x: 8.6, z: 4 });

    const a3 = applyCommand(a2, {
      type: 'furniture/update',
      id: sofa.id,
      patch: { dimensions: { width: 2, depth: 0.9, height: 0.8 } },
    });
    expect(a3.floors[0]!.furniture[0]!.dimensions.width).toBe(2);

    const a4 = applyCommand(a3, { type: 'furniture/remove', id: sofa.id });
    expect(a4.floors[0]!.furniture).toHaveLength(0);
  });

  it('renovates one room without touching geometry or other rooms', () => {
    const a0 = e2();
    const a1 = applyCommand(a0, {
      type: 'room/renovate',
      roomId: 'bedroom-1',
      patch: { floorMaterialId: 'floor-marble', wallColor: '#ffeedd' },
    });
    const [f0, f1] = [a0.floors[0]!, a1.floors[0]!];
    const b1 = f1.rooms.find((r) => r.id === 'bedroom-1')!;
    expect(b1.renovation).toMatchObject({
      floorMaterialId: 'floor-marble',
      wallColor: '#ffeedd',
      wallMaterialId: 'paint-white',
    });
    // Geometry and unrelated rooms keep referential identity (cheap undo, no re-mesh).
    expect(b1.polygon).toBe(f0.rooms.find((r) => r.id === 'bedroom-1')!.polygon);
    expect(f1.walls).toBe(f0.walls);
    expect(f1.rooms.find((r) => r.id === 'bedroom-2')).toBe(f0.rooms.find((r) => r.id === 'bedroom-2'));
  });

  it('updates doors and windows and applies batches in order', () => {
    const a = applyCommand(e2(), {
      type: 'batch',
      label: 'Refit',
      commands: [
        { type: 'door/update', id: 'd-bed1', patch: { materialId: 'wood-oak' } },
        { type: 'window/update', id: 'win-bed1', patch: { materialId: 'aluminium-dark' } },
        { type: 'room/rename', roomId: 'bedroom-1', name: 'Main bedroom' },
      ],
    });
    const f = a.floors[0]!;
    expect(f.doors.find((d) => d.id === 'd-bed1')!.materialId).toBe('wood-oak');
    expect(f.windows.find((w) => w.id === 'win-bed1')!.materialId).toBe('aluminium-dark');
    expect(f.rooms.find((r) => r.id === 'bedroom-1')).toMatchObject({
      name: 'Main bedroom',
      labelSource: 'user',
    });
  });

  it('fails loudly on unknown targets and duplicate ids', () => {
    expect(() => applyCommand(e2(), { type: 'furniture/remove', id: 'nope' })).toThrow(CommandError);
    expect(() => applyCommand(e2(), { type: 'furniture/add', item: { ...sofa, roomId: 'nope' } })).toThrow(
      CommandError,
    );
    const a = applyCommand(e2(), { type: 'furniture/add', item: sofa });
    expect(() => applyCommand(a, { type: 'furniture/add', item: sofa })).toThrow(/already exists/);
  });

  it('describes commands for the undo menu', () => {
    expect(describeCommand({ type: 'furniture/update', id: 'x', patch: { rotation: 1 } })).toBe(
      'Rotate furniture',
    );
    expect(
      describeCommand({ type: 'room/renovate', roomId: 'x', patch: { floorMaterialId: 'floor-oak' } }),
    ).toBe('Change flooring');
  });
});
