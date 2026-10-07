import { describe, expect, it } from 'vitest';
import { blankImage, paintArc, paintLine, paintPolygon } from '../../test/rasterPlan';
import { preprocessImage } from './preprocess';
import { newMask, type RgbaImage } from './raster';
import { proposeTextLines, textOnlyImage } from './textRegions';

/** Glyph-like blobs: a row of small filled shapes, letter-spaced. */
function word(img: RgbaImage, x: number, y: number, letters: number, h = 11) {
  for (let k = 0; k < letters; k++) {
    const x0 = x + k * (0.7 * h + 2);
    paintPolygon(
      img,
      [
        { x: x0, y },
        { x: x0 + 0.7 * h, y },
        { x: x0 + 0.7 * h, y: y + h },
        { x: x0, y: y + h },
      ],
      30,
    );
    // A hole so the blob is letter-like rather than solid.
    paintPolygon(
      img,
      [
        { x: x0 + 2, y: y + 3 },
        { x: x0 + 0.7 * h - 2, y: y + 3 },
        { x: x0 + 0.7 * h - 2, y: y + h - 3 },
        { x: x0 + 2, y: y + h - 3 },
      ],
      255,
    );
  }
}

const noWalls = (img: RgbaImage) => newMask(img.width, img.height);

describe('proposeTextLines', () => {
  it('chains letter blobs into one line box per word group', () => {
    const img = blankImage(300, 120);
    word(img, 20, 20, 7); // "BEDROOM"
    word(img, 150, 20, 4); // same baseline, far away → separate line
    word(img, 20, 60, 5); // next line
    const { lines } = proposeTextLines(preprocessImage(img).ink, noWalls(img));
    expect(lines).toHaveLength(3);
    expect(lines[0]!.x0).toBeLessThan(20);
    expect(lines[0]!.x1).toBeGreaterThan(20 + 6 * 9.7);
  });

  it('does not propose lines, arcs or lone symbols as text', () => {
    const img = blankImage(300, 200);
    paintLine(img, { x: 10, y: 100 }, { x: 290, y: 100 }, 1.4, 60);
    paintArc(img, { x: 100, y: 180 }, 60, { x: 100, y: 120 }, { x: 160, y: 180 }, 1.4, 60);
    paintPolygon(
      img,
      [
        { x: 250, y: 20 },
        { x: 258, y: 20 },
        { x: 258, y: 30 },
        { x: 250, y: 30 },
      ],
      30,
    );
    expect(proposeTextLines(preprocessImage(img).ink, noWalls(img)).lines).toEqual([]);
  });

  it('paints everything but the glyphs white for line reads', () => {
    const img = blankImage(300, 120);
    word(img, 20, 20, 5);
    paintLine(img, { x: 10, y: 40 }, { x: 290, y: 40 }, 1.4, 60); // a dimension line under the text
    const pre = preprocessImage(img);
    const clean = textOnlyImage(img, proposeTextLines(pre.ink, noWalls(img)).glyphs);
    const at = (x: number, y: number) => clean.data[(y * img.width + x) * 4]!;
    expect(at(21, 21)).toBeLessThan(100); // glyph kept
    expect(at(200, 40)).toBe(255); // line removed
  });
});
