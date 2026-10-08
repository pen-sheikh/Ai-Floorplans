import { describe, expect, it } from 'vitest';
import { SYNTHETIC_MM_ANNOTATIONS as GT } from '../fixtures/synthetic-mm/annotations';
import { validateAnnotations } from '../validateAnnotations';
import { sanitizeAnnotations } from './sanitize';

const auto = { ...GT, source: { method: 'automatic' as const } };

describe('sanitizeAnnotations', () => {
  it('leaves valid annotations unchanged', () => {
    const r = sanitizeAnnotations(auto);
    expect(r.problems).toEqual([]);
    expect(r.annotations.doors).toHaveLength(GT.doors.length);
    expect(r.annotations.rooms).toHaveLength(GT.rooms.length);
  });

  it('merges overlapping openings of the same kind and drops the weaker of different kinds', () => {
    const top = GT.windows.find((w) => w.wallId === 'ext-top')!;
    const ann = {
      ...auto,
      windows: [
        ...GT.windows,
        { ...top, id: 'dup', span: [top.span[0] + 20, top.span[1] + 20] as [number, number] },
      ],
      doors: [
        ...GT.doors,
        {
          id: 'ghost',
          wallId: 'ext-top',
          span: [top.span[0] + 10, top.span[0] + 40] as [number, number],
          kind: 'opening' as const,
          hinge: 'min' as const,
          swing: 'down' as const,
          confidence: 0.4,
        },
      ],
    };
    const r = sanitizeAnnotations(ann);
    expect(validateAnnotations(r.annotations).filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.annotations.doors.find((d) => d.id === 'ghost')).toBeUndefined();
    expect(r.annotations.windows.filter((w) => w.wallId === 'ext-top')).toHaveLength(2);
    expect(r.problems.every((p) => p.category === 'annotation_conflict')).toBe(true);
  });

  it('drops openings outside their wall and rooms with invalid outlines, saying so', () => {
    const ann = {
      ...auto,
      doors: [...GT.doors, { ...GT.doors[0]!, id: 'outside', span: [5000, 5050] as [number, number] }],
      rooms: [
        ...GT.rooms,
        {
          ...GT.rooms[0]!,
          id: 'bow-tie',
          polygon: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
            { x: 100, y: 0 },
            { x: 0, y: 100 },
          ],
        },
      ],
    };
    const r = sanitizeAnnotations(ann);
    expect(r.annotations.doors.map((d) => d.id)).not.toContain('outside');
    expect(r.annotations.rooms.map((x) => x.id)).not.toContain('bow-tie');
    expect(r.problems.map((p) => p.code)).toEqual(expect.arrayContaining(['sanitized', 'room-dropped']));
    expect(r.annotations.rooms).toHaveLength(GT.rooms.length);
  });
});
