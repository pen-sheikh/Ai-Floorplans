import { describe, expect, it } from 'vitest';
import { blankImage, rasterPlan } from '../../test/rasterPlan';
import { degradeImage } from '../corpus/degrade';
import {
  SYNTHETIC_CORRIDOR_ANNOTATIONS,
  SYNTHETIC_CORRIDOR_STYLE,
} from '../fixtures/synthetic-corridor/annotations';
import { assessDocument, measureDocument } from './documentCheck';
import { preprocessImage } from './preprocess';
import type { RgbaImage } from './raster';

const check = (img: RgbaImage) => assessDocument(measureDocument(preprocessImage(img)));
const noise = (w: number, h: number): RgbaImage => {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = 9;
  for (let i = 0; i < data.length; i += 4) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = data[i + 1] = data[i + 2] = s >>> 24;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
};

describe('document check: is this probably a floor plan?', () => {
  const plan = rasterPlan(SYNTHETIC_CORRIDOR_ANNOTATIONS, SYNTHETIC_CORRIDOR_STYLE);

  it('recognises a plan, and a degraded scan of it', () => {
    expect(check(plan).verdict).toBe('LIKELY_FLOOR_PLAN');
    const scan = degradeImage(plan, {
      blur: 1,
      noise: 12,
      paper: 210,
      contrast: 0.8,
      vignette: 0.3,
      seed: 2,
    });
    expect(check(scan).verdict).toBe('LIKELY_FLOOR_PLAN');
  });

  it('rejects noise and an empty page, with evidence', () => {
    const n = check(noise(400, 300));
    expect(n.verdict).toBe('UNLIKELY_FLOOR_PLAN');
    expect(n.evidence.join(' ')).toMatch(/straight lines/);
    expect(check(blankImage(400, 300)).verdict).toBe('UNLIKELY_FLOOR_PLAN');
  });

  it('never claims certainty', () => {
    expect(check(plan).confidence).toBeLessThan(1);
    expect(check(noise(200, 200)).confidence).toBeGreaterThan(0);
  });
});
