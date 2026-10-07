import { describe, expect, it } from 'vitest';
import { blankImage, paintLine } from '../../test/rasterPlan';
import { measureDimensionLines } from './dimensionLines';
import { newMask } from './raster';
import { preprocessImage } from './preprocess';

const text = { meters: 8, text: '8.00m', box: { x0: 280, y0: 62, x1: 320, y1: 74 }, confidence: 0.9 };

function drawDimension(ticks: boolean) {
  const img = blankImage(600, 200);
  paintLine(img, { x: 100, y: 80 }, { x: 500, y: 80 }, 1, 60);
  if (ticks) for (const x of [100, 500]) paintLine(img, { x, y: 74 }, { x, y: 86 }, 1, 60);
  return img;
}

describe('measureDimensionLines', () => {
  it('measures a dimension line tick to tick next to its printed value', () => {
    const img = drawDimension(true);
    const [m] = measureDimensionLines(preprocessImage(img).gray, newMask(600, 200), 215, [text]);
    expect(m).toBeDefined();
    expect(m!.meters).toBe(8);
    expect(Math.abs(m!.a.x - 100)).toBeLessThan(1);
    expect(Math.abs(m!.b.x - 500)).toBeLessThan(1);
    expect(m!.confidence).toBeCloseTo(0.9, 6);
  });

  it('uses the line ends, with lower confidence, when there are no ticks', () => {
    const [m] = measureDimensionLines(preprocessImage(drawDimension(false)).gray, newMask(600, 200), 215, [
      text,
    ]);
    expect(m!.confidence).toBeLessThan(0.9);
    expect(Math.abs(m!.b.x - m!.a.x - 400)).toBeLessThan(3); // includes the stroke caps
  });

  it('finds nothing when no line accompanies the text', () => {
    expect(
      measureDimensionLines(preprocessImage(blankImage(600, 200)).gray, newMask(600, 200), 215, [text]),
    ).toEqual([]);
  });

  it('rejects a "line" that is really the edge of wall fill', () => {
    const img = drawDimension(true);
    const walls = newMask(600, 200);
    for (let y = 70; y < 90; y++) for (let x = 501; x < 520; x++) walls.data[y * 600 + x] = 1;
    // Extend the line into the wall so it stops at the fill.
    paintLine(img, { x: 100, y: 80 }, { x: 501, y: 80 }, 1, 60);
    expect(measureDimensionLines(preprocessImage(img).gray, walls, 215, [text])).toEqual([]);
  });
});
