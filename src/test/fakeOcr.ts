import type { Box, RgbaImage } from '../floorplan/cv/raster';
import type { OcrProvider, OcrWord } from '../floorplan/cv/text';
import type { FloorPlanAnnotations } from '../floorplan/annotationTypes';
import { DEFAULT_PLAN_STYLE, planPrimitives, type PlanStyle } from '../floorplan/fixtures/render/planSvg';

/**
 * OCR stand-in for tests: "reads" exactly the text a plan drawing contains (horizontal text
 * only, like the real page OCR), one word per space-separated token, with a fixed confidence.
 */
export class FakeOcr implements OcrProvider {
  readonly name = 'fake-ocr';
  calls = 0;
  constructor(private readonly words: OcrWord[]) {}

  static forPlan(
    ann: FloorPlanAnnotations,
    style: PlanStyle = DEFAULT_PLAN_STYLE,
    confidence = 0.95,
  ): FakeOcr {
    const words: OcrWord[] = [];
    for (const p of planPrimitives(ann, style)) {
      if (p.kind !== 'text' || p.rotateDeg) continue;
      const charW = 0.6 * p.size;
      const total = p.text.length * charW;
      let x = p.at.x - total / 2;
      for (const token of p.text.split(' ')) {
        const w = token.length * charW;
        if (token)
          words.push({
            text: token,
            confidence,
            box: { x0: x, y0: p.at.y - p.size / 2, x1: x + w, y1: p.at.y + p.size / 2 },
          });
        x += w + charW;
      }
    }
    return new FakeOcr(words);
  }

  async recognize(_image: RgbaImage, opts: { region?: Box } = {}): Promise<OcrWord[]> {
    this.calls++;
    const r = opts.region;
    if (!r) return this.words;
    return this.words.filter((w) => {
      const cx = (w.box.x0 + w.box.x1) / 2;
      const cy = (w.box.y0 + w.box.y1) / 2;
      return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
    });
  }
}
