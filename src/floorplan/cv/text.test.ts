import { describe, expect, it } from 'vitest';
import { blankImage } from '../../test/rasterPlan';
import type { Box, RgbaImage } from './raster';
import {
  groupLines,
  looksLikeDimension,
  matchRoomName,
  parseArea,
  parseDimension,
  parseFloorLabel,
  readPlanText,
  type OcrProvider,
  type OcrWord,
} from './text';

const word = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 0.9): OcrWord => ({
  text,
  confidence,
  box: { x0, y0, x1, y1 },
});

describe('matchRoomName', () => {
  it.each([
    ['BEDROOM', 'bedroom'],
    ['BED ROOM', 'bedroom'],
    ['BEDR00M', 'bedroom'],
    ['Bedroom 2', 'bedroom'],
    ['Kitchen/Lounge/Diner', 'kitchen-living'],
    ['LIVING / DINING', 'living'],
    ['En-suite', 'bathroom'],
    ['W.C.', 'toilet'],
    ['Balcony', 'balcony'],
    ['Living Room', 'living'],
  ])('%s → %s', (raw, type) => {
    expect(matchRoomName(raw)?.type).toBe(type);
  });

  it('keeps the text exactly as read and charges confidence for corrections', () => {
    const exact = matchRoomName('BEDROOM', 0.9)!;
    const fixed = matchRoomName('BEDR00M', 0.9)!;
    expect(fixed.raw).toBe('BEDR00M');
    expect(fixed.corrections).toBeGreaterThan(0);
    expect(fixed.confidence).toBeLessThan(exact.confidence);
  });

  it.each([
    '3.84m x 2.66m',
    'Approx. 57.4 sq. metres',
    '(excluding Balcony)',
    'Ceiling height reduced in the kitchen area',
    'XQZT',
    'NE',
  ])('rejects %j', (raw) => {
    expect(matchRoomName(raw)).toBeNull();
  });
});

describe('parseDimension', () => {
  it.each([
    ['3.84m x 2.66m', [3.84, 2.66], 'm'],
    ['6.39 x 3.77 m', [6.39, 3.77], 'm'],
    ['3,20 x 2,95', [3.2, 2.95], 'm'],
    ['4200 x 3100 mm', [4.2, 3.1], 'mm'],
    ['5825 x 7250', [5.825, 7.25], 'mm'],
    ['8.00m', [8], 'm'],
    ['12.00 m', [12], 'm'],
    ['4200', [4.2], 'mm'],
  ] as const)('%s', (text, values, unit) => {
    const d = parseDimension(text)!;
    expect(d.values).toEqual(values);
    expect(d.unit).toBe(unit);
    expect(d.raw).toBe(text);
  });

  it.each(['12\'7" x 8\'9"', 'KITCHEN', '2', '57'])('ignores %j', (text) => {
    expect(parseDimension(text)).toBeNull();
  });

  it('flags unreadable numerics for a second read', () => {
    expect(looksLikeDimension('3.7/m')).toBe(true);
    expect(looksLikeDimension('Bedroom')).toBe(false);
  });
});

describe('area and floor labels', () => {
  it('reads reported areas in common forms', () => {
    expect(parseArea('Approx. 57.4 sq. metres')).toBe(57.4);
    expect(parseArea('Total area 68,6 m²')).toBe(68.6);
    expect(parseArea('Approx. 68.6 sq m')).toBe(68.6);
    expect(parseArea('Bedroom')).toBeNull();
  });

  it('reads floor labels', () => {
    expect(parseFloorLabel('THIRD FLOOR')).toBe('Third Floor');
    expect(parseFloorLabel('Lower ground floor')).toBe('Lower Ground Floor');
    expect(parseFloorLabel('Floor plan')).toBeNull();
  });
});

describe('groupLines', () => {
  it('groups words on a shared baseline in reading order and splits distant words', () => {
    const lines = groupLines([
      word('DINING', 70, 10, 120, 22),
      word('LIVING', 10, 10, 55, 22),
      word('/', 58, 10, 62, 22),
      word('KITCHEN', 400, 11, 460, 23),
      word('3.84m', 10, 30, 50, 40),
      word('x', 54, 32, 60, 40),
      word('2.66m', 64, 30, 104, 40),
    ]);
    expect(lines.map((l) => l.text)).toEqual(['LIVING / DINING', 'KITCHEN', '3.84m x 2.66m']);
  });

  it('does not let a tall junk box merge the lines above and below it', () => {
    const lines = groupLines([
      word('KITCHEN', 10, 10, 70, 21),
      word('3325x2825', 10, 28, 80, 38),
      word('I', 120, 0, 130, 50, 0.4),
    ]);
    expect(lines.map((l) => l.text)).toContain('KITCHEN');
    expect(lines.map((l) => l.text)).toContain('3325x2825');
  });
});

describe('readPlanText', () => {
  /** OCR stub: a page pass and per-region reads, scripted. */
  const provider = (
    page: OcrWord[],
    regionRead: (r: Box) => OcrWord[],
  ): OcrProvider & { regionCalls: number } => ({
    name: 'stub',
    regionCalls: 0,
    async recognize(_img: RgbaImage, o: { region?: Box } = {}) {
      if (!o.region) return page;
      this.regionCalls++;
      return regionRead(o.region);
    },
  });
  const img = blankImage(200, 100);

  it('classifies names, dimensions, area and floor label', async () => {
    const t = await readPlanText(
      img,
      provider(
        [
          word('BEDROOM', 10, 10, 70, 22),
          word('3.84m', 10, 26, 45, 36),
          word('x', 48, 28, 52, 36),
          word('2.66m', 55, 26, 90, 36),
          word('Approx.', 10, 80, 50, 90),
          word('57.4', 52, 80, 70, 90),
          word('sq.', 72, 80, 85, 90),
          word('metres', 87, 80, 120, 90),
          word('Third', 130, 5, 160, 15),
          word('Floor', 162, 5, 190, 15),
        ],
        () => [],
      ),
    );
    expect(t.names.map((n) => n.match.type)).toEqual(['bedroom']);
    expect(t.dimensions[0]!.parsed.values).toEqual([3.84, 2.66]);
    expect(t.reportedAreaM2).toBe(57.4);
    expect(t.floorLabel).toBe('Third Floor');
  });

  it('reads each proposed line on its own and prefers the reading that makes sense', async () => {
    const region = { x0: 5, y0: 5, x1: 80, y1: 25 };
    // The page pass mangled the label; the line read gets it right.
    const ocr = provider([word('itchen', 10, 8, 70, 22, 0.9)], () => [word('Kitchen', 8, 8, 70, 22, 0.85)]);
    const t = await readPlanText(img, ocr, { regions: [region] });
    expect(ocr.regionCalls).toBe(1);
    expect(t.names.map((n) => n.match.raw)).toEqual(['Kitchen']);
  });

  it('keeps the page reading when the line read is worse', async () => {
    const region = { x0: 5, y0: 5, x1: 80, y1: 25 };
    const ocr = provider([word('12.00m', 10, 8, 60, 20, 0.56)], () => [
      word('12.00', 10, 8, 45, 20, 0.55),
      word('IN', 47, 8, 60, 20, 0.55),
    ]);
    const t = await readPlanText(img, ocr, { regions: [region] });
    expect(t.dimensions.map((d) => d.parsed.values)).toEqual([[12]]);
  });
});
