import { describe, expect, it } from 'vitest';
import { box, miniPlan, wall } from '../../test/miniPlan';
import { blankImage, paintPolygon, rasterPlan } from '../../test/rasterPlan';
import { degradeImage, scaleAnnotations } from '../corpus/degrade';
import { calibrateAnnotations } from '../calibrate';
import { E2_ANNOTATIONS } from '../fixtures/e2/annotations';
import { validateAnnotations } from '../validateAnnotations';
import { normalisePolarity, preprocessImage, wallThicknessProfile } from './preprocess';
import type { GrayImage, RgbaImage } from './raster';
import { inferBoundaries, segmentRooms } from './rooms';
import { combineRoomNames, matchRoomName } from './text';
import { detectTintBands } from './tintBands';
import { detectWalls, type DetectedWall, type Pt } from './walls';

const dw = (id: string, a: Pt, b: Pt, thickness = 10): DetectedWall => ({
  id,
  a,
  b,
  thickness,
  ends: ['free', 'free'],
  coverage: 1,
  confidence: 1,
});

describe('preprocessing for unusual drawings', () => {
  it('treats coloured fills as paper but keeps dark linework', () => {
    const img = rasterPlan(miniPlan(300, 200, box(30, 30, 270, 170, 10)));
    // A large tan "floor" fill inside the room.
    for (let y = 50; y < 150; y++)
      for (let x = 50; x < 250; x++) img.data.set([200, 160, 110, 255], (y * 300 + x) * 4);
    const pre = preprocessImage(img);
    expect(pre.ink.data[100 * 300 + 150]).toBe(0); // the fill is not ink
    expect(pre.ink.data[30 * 300 + 150]).toBe(1); // the wall is
    expect(pre.tint.data[100 * 300 + 150]).toBe(1); // and the fill is remembered as tint
  });

  it('reads white walls on a grey ground (inverted polarity)', () => {
    const g: GrayImage = { width: 100, height: 50, data: new Uint8Array(5000).fill(200) };
    for (let x = 10; x < 90; x++) for (let y = 20; y < 30; y++) g.data[y * 100 + x] = 255; // white wall
    const out = normalisePolarity(g);
    expect(out.data[25 * 100 + 50]).toBeLessThan(80); // the wall is now dark ink
    expect(out.data[5 * 100 + 5]).toBe(255); // the grey ground is now paper
  });
});

describe('windows drawn as coloured bands', () => {
  it('become walls that carry a window; floor-sized colour areas do not', () => {
    // A box whose top wall has a gap filled with a cyan band (no glazing lines).
    const ann = miniPlan(400, 300, [
      wall('top-l', { x: 40, y: 40 }, { x: 140, y: 40 }, 12),
      wall('top-r', { x: 260, y: 40 }, { x: 360, y: 40 }, 12),
      ...box(40, 40, 360, 260, 12).slice(1),
    ]);
    const img = rasterPlan(ann);
    paintPolygon(
      img,
      [
        { x: 146, y: 34 },
        { x: 254, y: 34 },
        { x: 254, y: 46 },
        { x: 146, y: 46 },
      ],
      0,
    );
    for (let y = 34; y < 46; y++)
      for (let x = 146; x < 254; x++) img.data.set([0, 230, 230, 255], (y * 400 + x) * 4);
    for (let y = 100; y < 220; y++)
      for (let x = 80; x < 320; x++) img.data.set([230, 200, 150, 255], (y * 400 + x) * 4);
    const pre = preprocessImage(img);
    const profile = wallThicknessProfile(pre);
    const walls = detectWalls(pre, profile);
    const bands = detectTintBands(pre, profile, walls.wallMask);
    expect(bands).toHaveLength(1);
    expect(Math.abs(bands[0]!.a.y - 40)).toBeLessThan(2);
    expect(bands[0]!.thickness).toBeLessThan(16);
  });
});

describe('inferBoundaries', () => {
  // A box whose right wall stops short, leaving a 60 px gap to the bottom wall.
  const walls = [
    dw('top', { x: 0, y: 0 }, { x: 300, y: 0 }),
    dw('left', { x: 0, y: 0 }, { x: 0, y: 200 }),
    dw('bottom', { x: 0, y: 200 }, { x: 300, y: 200 }),
    dw('right', { x: 300, y: 0 }, { x: 300, y: 140 }),
  ];
  const mask = { width: 400, height: 300, data: new Uint8Array(400 * 300) };
  const shift = (ws: DetectedWall[]) =>
    ws.map((w) => ({ ...w, a: { x: w.a.x + 50, y: w.a.y + 50 }, b: { x: w.b.x + 50, y: w.b.y + 50 } }));

  it('closes a partition that stops short of the wall ahead', () => {
    const c = inferBoundaries(shift(walls), 10, mask);
    expect(c).toHaveLength(1);
    expect([c[0]!.fromWall, c[0]!.toWall].sort()).toEqual(['bottom', 'right']);
    expect(c[0]!.gapPx).toBeGreaterThan(50);
    expect(c[0]!.gapPx).toBeLessThan(62);
  });

  it('turns an open outline into a room only when the closure is used', () => {
    const ws = shift(walls);
    const open = segmentRooms(ws, 400, 300, 10, mask);
    expect(open.rooms).toHaveLength(0);
    const closed = segmentRooms(ws, 400, 300, 10, mask, {
      extraBarriers: inferBoundaries(ws, 10, mask).map((b) => ({ ...b, thickness: 3 })),
    });
    expect(closed.rooms).toHaveLength(1);
  });

  it('does not close across a drawn wall', () => {
    const blocked = { width: 400, height: 300, data: new Uint8Array(400 * 300) };
    for (let y = 215; y < 225; y++) for (let x = 300; x < 400; x++) blocked.data[y * 400 + x] = 1; // fill across the gap
    const c = inferBoundaries(shift(walls), 10, blocked);
    expect(c.every((b) => !(b.fromWall === 'right' && b.toWall === 'bottom'))).toBe(true);
  });
});

describe('combineRoomNames', () => {
  it('treats kitchen / living / dining in one space as one open-plan room', () => {
    const r = combineRoomNames([matchRoomName('KITCHEN')!, matchRoomName('LIVING')!]);
    expect(r.plausible).toBe(true);
    expect(r.match.type).toBe('kitchen-living');
    expect(r.match.display).toBe('Kitchen / Living');
  });

  it('flags two unrelated rooms sharing one space (a dividing wall was missed)', () => {
    const r = combineRoomNames([matchRoomName('BEDROOM')!, matchRoomName('BATHROOM')!]);
    expect(r.plausible).toBe(false);
    expect(r.match.type).toBe('unknown');
  });
});

describe('degradations and resized ground truth', () => {
  it('is deterministic and keeps the image size unless scaled', () => {
    const img: RgbaImage = blankImage(50, 40);
    const a = degradeImage(img, { noise: 10, seed: 3 });
    const b = degradeImage(img, { noise: 10, seed: 3 });
    expect([...a.data]).toEqual([...b.data]);
    expect(degradeImage(img, { scale: 0.5 })).toMatchObject({ width: 25, height: 20 });
  });

  it('scales annotations consistently: valid, and the same real-world size', () => {
    const half = scaleAnnotations(E2_ANNOTATIONS, 0.5);
    expect(validateAnnotations(half).filter((i) => i.severity === 'error')).toEqual([]);
    expect(calibrateAnnotations(half).pixelsPerMeter).toBeCloseTo(
      calibrateAnnotations(E2_ANNOTATIONS).pixelsPerMeter / 2,
      3,
    );
  });
});
