import { describe, expect, it } from 'vitest';
import { executeIntent } from '../ai/executeIntent';
import { getRenovationPreset } from '../catalog/renovationPresets';
import type { Apartment, Floor, FurnitureItem } from '../domain/types';
import { DEFAULT_CONSTRAINTS } from '../engine/constraints';
import { e2, testId } from '../test/fixtures';
import { applyCommand, type Command } from './commands';
import { planPreset, renovationCommands } from './operations';

const floorOf = (a: Apartment): Floor => a.floors[0]!;
const doorsOf = (a: Apartment, roomId: string) => {
  const f = floorOf(a);
  const ids = f.rooms.find((r) => r.id === roomId)!.doorIds;
  return f.doors.filter((d) => ids.includes(d.id));
};
const windowsOf = (a: Apartment, roomId: string) => {
  const f = floorOf(a);
  const ids = f.rooms.find((r) => r.id === roomId)!.windowIds;
  return f.windows.filter((w) => ids.includes(w.id));
};
const apply = (a: Apartment, cmd: Command | null) => {
  expect(cmd).not.toBeNull();
  return applyCommand(a, cmd!);
};

describe('style presets reach the rendered doors and windows', () => {
  it('a preset that defines a door finish changes the doors of the room (what 3D renders)', () => {
    const preset = getRenovationPreset('warm-modern')!;
    expect(preset.patch.doorMaterialId).toBe('wood-oak');
    const a = apply(e2(), planPreset(e2(), 'warm-modern', ['bedroom-1']));
    expect(floorOf(a).rooms.find((r) => r.id === 'bedroom-1')!.renovation.doorMaterialId).toBe('wood-oak');
    expect(doorsOf(a, 'bedroom-1').length).toBeGreaterThan(0);
    for (const d of doorsOf(a, 'bedroom-1')) expect(d.materialId).toBe('wood-oak');
  });

  it('a preset that defines a window finish changes the windows of the room', () => {
    expect(getRenovationPreset('industrial')!.patch.windowMaterialId).toBe('aluminium-dark');
    const a = apply(e2(), planPreset(e2(), 'industrial', ['bedroom-1']));
    expect(windowsOf(a, 'bedroom-1').length).toBeGreaterThan(0);
    for (const w of windowsOf(a, 'bedroom-1')) expect(w.materialId).toBe('aluminium-dark');
  });

  it('a preset without door/window finishes leaves doors and windows exactly as they were', () => {
    const preset = getRenovationPreset('bright-airy')!;
    expect(preset.patch.doorMaterialId).toBeUndefined();
    expect(preset.patch.windowMaterialId).toBeUndefined();
    const a0 = e2();
    const a = apply(
      a0,
      planPreset(
        a0,
        'bright-airy',
        floorOf(a0).rooms.map((r) => r.id),
      ),
    );
    expect(floorOf(a).doors).toBe(floorOf(a0).doors);
    expect(floorOf(a).windows).toBe(floorOf(a0).windows);
  });

  it('a whole-apartment preset changes every door and window that belongs to a styled room', () => {
    const a0 = e2();
    const all = floorOf(a0).rooms.map((r) => r.id);
    const a = apply(a0, planPreset(a0, 'industrial', all));
    const styled = floorOf(a).rooms.filter((r) => r.type !== 'balcony');
    const doorIds = new Set(styled.flatMap((r) => r.doorIds));
    const windowIds = new Set(styled.flatMap((r) => r.windowIds));
    for (const d of floorOf(a).doors) if (doorIds.has(d.id)) expect(d.materialId).toBe('wood-gray');
    for (const w of floorOf(a).windows) if (windowIds.has(w.id)) expect(w.materialId).toBe('aluminium-dark');
  });

  it('room panel, preset and assistant give the same doors and windows for the same finish', () => {
    const patch = { doorMaterialId: 'wood-oak', windowMaterialId: 'aluminium-dark' };
    const viaRoomPanel = applyCommand(e2(), {
      type: 'batch',
      label: 'x',
      commands: renovationCommands(e2(), 'bedroom-2', patch),
    });
    const viaAssistant = executeIntent(
      { action: 'renovate', roomIds: ['bedroom-2'], patch },
      { apartment: e2(), constraints: DEFAULT_CONSTRAINTS, newId: testId },
    );
    expect(viaAssistant.ok).toBe(true);
    const assistantResult = applyCommand(e2(), viaAssistant.command!);
    expect(floorOf(assistantResult).doors).toEqual(floorOf(viaRoomPanel).doors);
    expect(floorOf(assistantResult).windows).toEqual(floorOf(viaRoomPanel).windows);
    expect(doorsOf(viaRoomPanel, 'bedroom-2').every((d) => d.materialId === 'wood-oak')).toBe(true);
    expect(windowsOf(viaRoomPanel, 'bedroom-2').every((w) => w.materialId === 'aluminium-dark')).toBe(true);
  });

  it('touches nothing but finishes: geometry, furniture, provenance and unrelated rooms are kept', () => {
    const chair: FurnitureItem = {
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
    const a0 = applyCommand(e2(), { type: 'furniture/add', item: chair });
    const a = apply(a0, planPreset(a0, 'warm-modern', ['bedroom-1']));
    const [f0, f] = [floorOf(a0), floorOf(a)];
    expect(f.walls).toBe(f0.walls);
    expect(f.furniture).toBe(f0.furniture);
    expect(f.rooms.find((r) => r.id === 'bathroom')).toBe(f0.rooms.find((r) => r.id === 'bathroom'));
    for (const d of f.doors) {
      const before = f0.doors.find((x) => x.id === d.id)!;
      // Only the finish may change: position, size, swing and their provenance stay.
      expect({ ...d, materialId: before.materialId }).toEqual(before);
    }
    const untouched = f.doors.filter((d) => !d.connects.includes('bedroom-1'));
    for (const d of untouched) expect(d.materialId).toBe(f0.doors.find((x) => x.id === d.id)!.materialId);
  });

  it('a door shared by two renovated rooms takes the finish of the later one, deterministically', () => {
    const shared = floorOf(e2()).doors.find(
      (d) => d.connects.includes('bedroom-1') && d.connects.includes('hall'),
    )!;
    const a = applyCommand(e2(), {
      type: 'batch',
      label: 'x',
      commands: [
        ...renovationCommands(e2(), 'hall', { doorMaterialId: 'wood-gray' }),
        ...renovationCommands(e2(), 'bedroom-1', { doorMaterialId: 'wood-oak' }),
      ],
    });
    expect(floorOf(a).doors.find((d) => d.id === shared.id)!.materialId).toBe('wood-oak');
  });

  it('returns no commands for an unknown room', () => {
    expect(renovationCommands(e2(), 'nope', { doorMaterialId: 'wood-oak' })).toEqual([]);
  });
});
