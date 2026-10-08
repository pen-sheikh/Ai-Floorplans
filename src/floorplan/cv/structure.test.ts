import { describe, expect, it } from 'vitest';
import { assessStructure } from './structure';
import type { DetectedWall, Pt } from './walls';

const profile = { major: 12, minor: 6, modes: [6, 12] };
let n = 0;
const w = (a: Pt, b: Pt, thickness = 12, confidence = 1): DetectedWall => ({
  id: `w${++n}`,
  a,
  b,
  thickness,
  ends: ['free', 'free'],
  coverage: 1,
  confidence,
});
/** A closed 400 × 300 box of 12 px walls: the main structure. */
const box = () => [
  w({ x: 0, y: 0 }, { x: 400, y: 0 }),
  w({ x: 400, y: 0 }, { x: 400, y: 300 }),
  w({ x: 0, y: 300 }, { x: 400, y: 300 }),
  w({ x: 0, y: 0 }, { x: 0, y: 300 }),
  w({ x: 200, y: 0 }, { x: 200, y: 300 }, 6),
];

describe('assessStructure', () => {
  it('keeps a connected wall network intact', () => {
    const r = assessStructure(box(), profile);
    expect(r.walls).toHaveLength(5);
    expect(r.removed).toEqual([]);
  });

  it('drops a weak isolated stroke and a detached thin outline (furniture)', () => {
    const stroke = w({ x: 60, y: 150 }, { x: 90, y: 150 }, 4, 0.6);
    const table = [
      w({ x: 260, y: 120 }, { x: 320, y: 120 }, 4),
      w({ x: 320, y: 120 }, { x: 320, y: 170 }, 4),
      w({ x: 260, y: 170 }, { x: 320, y: 170 }, 4),
      w({ x: 260, y: 120 }, { x: 260, y: 170 }, 4),
    ];
    const r = assessStructure([...box(), stroke, ...table], profile);
    expect(r.removed.map((x) => x.id)).toEqual(
      expect.arrayContaining([stroke.id, ...table.map((t) => t.id)]),
    );
    expect(r.walls).toHaveLength(5);
  });

  it('keeps a solid detached pier of wall thickness, flagged as doubtful', () => {
    const pier = w({ x: 600, y: 100 }, { x: 600, y: 160 }, 14);
    const r = assessStructure([...box(), pier], profile);
    expect(r.walls.map((x) => x.id)).toContain(pier.id);
    expect(r.doubtful.map((x) => x.id)).toContain(pier.id);
  });

  it('drops lettering-like clusters of short oblique strokes', () => {
    // A bold "K": short strokes, two oblique, touching each other but not the walls.
    const k = [
      w({ x: 100, y: 100 }, { x: 100, y: 140 }, 8),
      w({ x: 100, y: 120 }, { x: 120, y: 100 }, 8),
      w({ x: 100, y: 120 }, { x: 120, y: 140 }, 8),
    ];
    const r = assessStructure([...box(), ...k], profile);
    expect(r.removed.map((x) => x.id)).toEqual(expect.arrayContaining(k.map((x) => x.id)));
  });
});
