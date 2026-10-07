import { describe, expect, it } from 'vitest';
import { roomMetrics } from '../domain/topology';
import { buildApartment } from '../floorplan';
import { SYNTHETIC_ANNOTATIONS } from '../floorplan/fixtures/synthetic/annotations';
import { suggestedPrompts } from './suggestions';

describe('assistant suggestions', () => {
  it('are built from whatever plan is loaded', () => {
    const rooms = buildApartment(SYNTHETIC_ANNOTATIONS).apartment.floors[0]!.rooms;
    const prompts = suggestedPrompts(
      rooms.map((r) => ({ name: r.name, type: r.type, areaM2: roomMetrics(r).area })),
    );
    expect(prompts).toContain('Put a 3-seat sofa against the longest wall in the Living');
    expect(prompts).toContain('Can I fit a king-size bed in Bedroom?');
    expect(prompts.join(' ')).not.toMatch(/Kitchen\/Lounge|Bedroom 1/);
  });

  it('degrade gracefully for plans without typical rooms', () => {
    expect(suggestedPrompts([{ name: 'Studio', type: 'unknown', areaM2: 20 }])).toEqual([]);
  });
});
