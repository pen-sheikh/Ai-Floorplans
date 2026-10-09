import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from '../domain/serialization';
import type { Apartment, Room } from '../domain/types';
import { automaticSynthetic as automatic, e2 } from '../test/fixtures';
import { applyCommand, CommandError } from './commands';

const roomOf = (apt: Apartment, id: string): Room => apt.floors[0]!.rooms.find((r) => r.id === id)!;

describe('room/rename provenance', () => {
  it('records the user as the source of an OCR-read name, and changes nothing else', () => {
    const a0 = automatic();
    const id = a0.floors[0]!.rooms[0]!.id;
    const before = roomOf(a0, id);
    expect(before.sources.name).toBe('ocr');

    const after = roomOf(applyCommand(a0, { type: 'room/rename', roomId: id, name: 'Study' }), id);
    expect(after).toMatchObject({ name: 'Study', labelSource: 'user' });
    expect(after.sources).toEqual({ ...before.sources, name: 'user' });
    // Type, its provenance, geometry and the extractor's audit trail are untouched.
    expect(after.type).toBe(before.type);
    expect(after.sources.type).toBe(before.sources.type);
    expect(after.sources.geometry).toBe(before.sources.geometry);
    expect(after.polygon).toBe(before.polygon);
    expect(after).toMatchObject({
      geometryConfidence: 0.9,
      labelConfidence: 0.8,
      classificationConfidence: 0.7,
      classification: before.classification,
      renovation: before.renovation,
    });
    expect(after.planLabel).toEqual(before.planLabel);
  });

  it('marks a renamed hand-annotated room as user-named too', () => {
    const before = roomOf(e2(), 'bedroom-1');
    expect(before.sources.name).toBeUndefined();
    const after = roomOf(
      applyCommand(e2(), { type: 'room/rename', roomId: 'bedroom-1', name: 'Main bedroom' }),
      'bedroom-1',
    );
    expect(after.sources).toEqual({ ...before.sources, name: 'user' });
    expect(after.type).toBe('bedroom');
  });

  it('rejects an empty name instead of storing it', () => {
    expect(() => applyCommand(e2(), { type: 'room/rename', roomId: 'hall', name: '   ' })).toThrow(
      CommandError,
    );
  });

  it('survives save and load', () => {
    const a0 = automatic();
    const id = a0.floors[0]!.rooms[0]!.id;
    const renamed = applyCommand(a0, { type: 'room/rename', roomId: id, name: 'Study' });
    const { apartment } = deserializeProject(serializeProject(renamed));
    expect(roomOf(apartment, id)).toMatchObject({
      name: 'Study',
      labelSource: 'user',
      sources: { name: 'user' },
    });
  });
});
