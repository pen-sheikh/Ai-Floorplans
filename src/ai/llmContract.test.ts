import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTRAINTS } from '../engine/constraints';
import { e2 } from '../test/fixtures';
import { pointInPolygon, polygonCentroid } from '../domain/geometry';
import { checkPlacement, doorZones } from '../engine/placement';
import { constraintsFor } from './executeIntent';
import { buildIntentContext } from './intents';
import { JsonIntentProvider, parseAssistantJson } from './llmContract';

const apt = e2();
const ctx = buildIntentContext(apt);
const C = { ...DEFAULT_CONSTRAINTS, blocking: [...DEFAULT_CONSTRAINTS.blocking] };
const errorsOf = (raw: unknown) => {
  const r = parseAssistantJson(raw, ctx);
  return r.ok ? [] : r.errors;
};

describe('LLM JSON contract', () => {
  it('accepts the documented fit_furniture shape, resolving names and quantities', () => {
    const r = parseAssistantJson(
      '{"intent":"fit_furniture","room":"living-room","items":[{"type":"three-seat-sofa","quantity":1},{"type":"coffee-table"}],"constraints":{"minimumWalkway":0.7}}',
      ctx,
    );
    expect(r).toEqual({
      ok: true,
      intents: [
        {
          action: 'place_furniture',
          roomId: 'kitchen-living',
          furniture: ['sofa-3', 'coffee-table'],
          constraints: { minimumWalkway: 0.7 },
        },
      ],
    });
  });

  it('tolerates a markdown code fence but nothing else around the JSON', () => {
    expect(parseAssistantJson('```json\n{"intent":"describe_room","room":"bathroom"}\n```', ctx).ok).toBe(
      true,
    );
    expect(errorsOf('Sure! {"intent":"describe_room","room":"bathroom"}')).toEqual([
      'Response is not valid JSON.',
    ]);
  });

  it('rejects unknown intents, fields, rooms, furniture and materials', () => {
    expect(errorsOf({ intent: 'delete_walls' })[0]).toMatch(/Unknown intent/);
    expect(errorsOf({ intent: 'describe_room', room: 'bathroom', threejs: 'scene.remove()' })).toContain(
      'Unexpected field "threejs" for describe_room.',
    );
    expect(errorsOf({ intent: 'describe_room', room: 'garage' })[0]).toMatch(/Unknown room "garage"/);
    expect(
      errorsOf({ intent: 'fit_furniture', room: 'bathroom', items: [{ type: 'grand piano' }] }),
    ).toContain('Unknown furniture "grand piano".');
    expect(errorsOf({ intent: 'renovate', room: 'hall', finishes: { floor: 'lava' } })).toContain(
      'Unknown floor material "lava".',
    );
  });

  it('bounds quantities, clearances and payload size', () => {
    expect(
      errorsOf({ intent: 'fit_furniture', room: 'hall', items: [{ type: 'plant', quantity: 500 }] })[0],
    ).toMatch(/Quantity/);
    expect(
      errorsOf({
        intent: 'fit_furniture',
        room: 'hall',
        items: [{ type: 'plant' }],
        constraints: { minimumWalkway: -1 },
      })[0],
    ).toMatch(/between 0.3 and 2/);
    expect(errorsOf('x'.repeat(30_000))).toEqual(['Response too large.']);
    expect(errorsOf(Array(6).fill({ intent: 'describe_room', room: 'hall' }))[0]).toMatch(/At most 5/);
  });

  it('reports every error at once so the model can be re-prompted', () => {
    expect(
      errorsOf({ intent: 'fit_furniture', room: 'garage', items: [{ type: 'unicorn' }], colour: 'red' }),
    ).toHaveLength(3);
  });

  it('turns keepDoorsClear into a hard rule the engine enforces', () => {
    const r = parseAssistantJson(
      {
        intent: 'fit_furniture',
        room: 'hall',
        items: [{ type: 'plant' }],
        constraints: { keepDoorsClear: true, minimumWalkway: 0.9 },
      },
      ctx,
    );
    expect(r.ok && r.intents[0]).toMatchObject({
      constraints: { preserveDoorClearance: true, minimumWalkway: 0.9 },
    });
    const strict = constraintsFor(C, { preserveDoorClearance: true, minimumWalkway: 0.9 });
    expect(strict).toMatchObject({ walkingClearance: 0.9, requireClear: ['door-clearance'] });
    // A plant right outside the Bedroom 1 door: soft by default, hard when doors must stay clear.
    const floor = apt.floors[0]!;
    const door = floor.doors.find((d) => d.id === 'd-bed1')!;
    const wall = floor.walls.find((w) => w.id === door.wallId)!;
    const outside = doorZones(door, wall, C)
      .clearance.map((z) => polygonCentroid(z))
      .find((p) => pointInPolygon(p, floor.rooms.find((x) => x.id === 'hall')!.polygon))!;
    const subject = {
      catalogId: 'plant',
      roomId: 'hall',
      position: outside,
      rotation: 0,
      dimensions: { width: 0.3, depth: 0.3, height: 1 },
    };
    expect(checkPlacement(floor, subject, C).issues.find((i) => i.code === 'door-clearance')?.severity).toBe(
      'soft',
    );
    const hard = checkPlacement(floor, subject, strict);
    expect(hard.issues.find((i) => i.code === 'door-clearance')?.severity).toBe('hard');
    expect(hard.hard).toBe(true);
  });

  it('a provider with an injected completion never executes rejected output', async () => {
    const hostile = new JsonIntentProvider(
      async () => '{"intent":"fit_furniture","room":"hall","items":[{"type":"plant"}],"eval":"alert(1)"}',
    );
    const [intent] = await hostile.parse('add a plant', ctx);
    expect(intent).toMatchObject({ action: 'unknown' });
    expect((intent as { reason: string }).reason).toMatch(/rejected.*Unexpected field "eval"/);
    const good = new JsonIntentProvider(async (prompt) => {
      expect(prompt).toContain('"id":"kitchen-living"');
      return '{"intent":"check_fit","room":"bedroom 1","items":[{"type":"king size bed"}]}';
    });
    expect(await good.parse('can a king bed fit in bedroom 1?', ctx)).toEqual([
      { action: 'check_fit', roomId: 'bedroom-1', furniture: 'bed-king' },
    ]);
  });
});
