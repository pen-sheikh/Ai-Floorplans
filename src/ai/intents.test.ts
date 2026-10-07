import { describe, expect, it } from 'vitest';
import { applyCommand } from '../editor/commands';
import { DEFAULT_CONSTRAINTS } from '../engine/constraints';
import { e2, testId } from '../test/fixtures';
import { executeIntent } from './executeIntent';
import { buildIntentContext, validateIntent, type Intent } from './intents';
import { matchFurniture, parseIntents } from './ruleBasedProvider';

const apt = e2();
const ctx = buildIntentContext(apt);
const C = { ...DEFAULT_CONSTRAINTS, blocking: [...DEFAULT_CONSTRAINTS.blocking] };
const run = (intent: Intent) => executeIntent(intent, { apartment: apt, constraints: C, newId: testId });

describe('natural language → structured intent', () => {
  it('parses a furniture placement with a wall preference', () => {
    expect(parseIntents('Put a 3-seat sofa against the longest wall in the living room.', ctx)).toEqual([
      {
        action: 'place_furniture',
        roomId: 'kitchen-living',
        furniture: ['sofa-3'],
        placement: 'longest_wall',
        constraints: { preserveDoorClearance: true, preserveWindowAccess: true },
      },
    ]);
  });

  it('parses lists and quantities of furniture', () => {
    expect(matchFurniture('Fit a sofa, TV unit and coffee table')).toEqual([
      'sofa-3',
      'tv-unit',
      'coffee-table',
    ]);
    expect(matchFurniture('add 4 dining chairs and a king size bed')).toEqual([
      'dining-chair',
      'dining-chair',
      'dining-chair',
      'dining-chair',
      'bed-king',
    ]);
  });

  it('parses fit questions, using the selected room for "here"', () => {
    expect(parseIntents('Can I fit a king-size bed here?', { ...ctx, selectedRoomId: 'bedroom-2' })).toEqual([
      { action: 'check_fit', roomId: 'bedroom-2', furniture: 'bed-king' },
    ]);
  });

  it('parses explicit finishes and does not mistake them for a style preset', () => {
    const [intent] = parseIntents('Renovate the bedroom with warm wood flooring and light beige walls.', ctx);
    expect(intent).toMatchObject({
      action: 'renovate',
      roomIds: ['bedroom-1'],
      patch: { floorMaterialId: 'floor-oak', wallMaterialId: 'paint-beige' },
    });
    expect(intent).not.toHaveProperty('preset');
    expect(parseIntents('Replace the kitchen flooring with marble', ctx)[0]).toMatchObject({
      roomIds: ['kitchen-living'],
      patch: { floorMaterialId: 'floor-marble' },
    });
  });

  it('maps style requests to presets', () => {
    expect(parseIntents('Make the living room Scandinavian', ctx)[0]).toMatchObject({
      action: 'renovate',
      preset: 'scandinavian',
    });
    expect(parseIntents('Make the bedroom feel larger', ctx)[0]).toMatchObject({
      action: 'renovate',
      roomIds: ['bedroom-1'],
      preset: 'bright-airy',
    });
    expect(parseIntents('make bedroom 2 industrial', ctx)[0]).toMatchObject({
      roomIds: ['bedroom-2'],
      preset: 'industrial',
    });
  });

  it('asks for clarification rather than guessing', () => {
    expect(parseIntents('make it nicer', ctx)[0]!.action).toBe('unknown');
  });
});

describe('intent validation and deterministic execution', () => {
  it('rejects intents that reference unknown rooms, furniture or materials', () => {
    expect(
      validateIntent({ action: 'place_furniture', roomId: 'garage', furniture: ['sofa-3'] }, ctx),
    ).toContain('Unknown room "garage".');
    expect(validateIntent({ action: 'check_fit', roomId: 'hall', furniture: 'piano' }, ctx)[0]).toMatch(
      /Unknown furniture/,
    );
    expect(
      validateIntent({ action: 'renovate', roomIds: ['hall'], patch: { floorMaterialId: 'lava' } }, ctx)[0],
    ).toMatch(/Unknown material/);
    expect(run({ action: 'place_furniture', roomId: 'garage', furniture: ['sofa-3'] }).ok).toBe(false);
  });

  it('places furniture through the fitting engine', () => {
    const res = run({
      action: 'place_furniture',
      roomId: 'kitchen-living',
      furniture: ['sofa-3', 'coffee-table'],
      placement: 'longest_wall',
    });
    expect(res.ok).toBe(true);
    expect(res.command?.type).toBe('batch');
    const after = applyCommand(apt, res.command!);
    expect(after.floors[0]!.furniture.map((f) => f.catalogId)).toEqual(['sofa-3', 'coffee-table']);
    expect(res.reply).toMatch(/against the ≈ 6\.39 m wall/);
  });

  it('answers fit questions without changing the model, offering a follow-up', () => {
    const yes = run({ action: 'check_fit', roomId: 'bedroom-1', furniture: 'bed-king' });
    expect(yes.command).toBeUndefined();
    expect(yes.reply).toMatch(/^Yes/);
    expect(yes.suggestion?.command.type).toBe('furniture/add');
    const no = run({ action: 'check_fit', roomId: 'bathroom', furniture: 'bed-king' });
    expect(no.reply).toMatch(/^No/);
  });

  it('turns renovation intents into room commands', () => {
    const res = run({
      action: 'renovate',
      roomIds: ['bedroom-2'],
      patch: { floorMaterialId: 'floor-walnut' },
    });
    const after = applyCommand(apt, res.command!);
    expect(after.floors[0]!.rooms.find((r) => r.id === 'bedroom-2')!.renovation.floorMaterialId).toBe(
      'floor-walnut',
    );
    const preset = run({ action: 'renovate', roomIds: ['bathroom'], preset: 'classic-luxe' });
    const lux = applyCommand(apt, preset.command!);
    // Wet rooms get the preset's wet-room variant.
    expect(lux.floors[0]!.rooms.find((r) => r.id === 'bathroom')!.renovation.floorMaterialId).toBe(
      'floor-marble',
    );
  });
});
