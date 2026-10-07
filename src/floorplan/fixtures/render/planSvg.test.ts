import { describe, expect, it } from 'vitest';
import { SYNTHETIC_CORRIDOR_ANNOTATIONS, SYNTHETIC_CORRIDOR_STYLE } from '../synthetic-corridor/annotations';
import { planPrimitives, renderPlanSvg } from './planSvg';

describe('plan renderer', () => {
  const prims = planPrimitives(SYNTHETIC_CORRIDOR_ANNOTATIONS, SYNTHETIC_CORRIDOR_STYLE);

  it('draws solid walls, hollow railings, door leaves with arcs and labels', () => {
    const solid = SYNTHETIC_CORRIDOR_ANNOTATIONS.walls.filter((w) => w.kind !== 'railing').length;
    expect(
      prims.filter((p) => p.kind === 'polygon' && p.fill === SYNTHETIC_CORRIDOR_STYLE.wallFill),
    ).toHaveLength(solid);
    const leaves = SYNTHETIC_CORRIDOR_ANNOTATIONS.doors.reduce(
      (n, d) => n + (d.kind === 'double' ? 2 : d.kind === 'opening' ? 0 : 1),
      0,
    );
    expect(prims.filter((p) => p.kind === 'arc')).toHaveLength(leaves);
    const texts = prims.filter((p) => p.kind === 'text').map((p) => (p.kind === 'text' ? p.text : ''));
    expect(texts).toEqual(
      expect.arrayContaining(['Lounge', 'Kitchen / Diner', 'Balcony', '12.00 m', '8.40 m']),
    );
  });

  it('serialises to a standalone SVG of the image size', () => {
    const svg = renderPlanSvg(SYNTHETIC_CORRIDOR_ANNOTATIONS, SYNTHETIC_CORRIDOR_STYLE);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="720" height="500"/);
    expect(svg.match(/<path /g)).toHaveLength(prims.filter((p) => p.kind === 'arc').length);
    expect(svg).toContain('Kitchen / Diner');
  });
});
