import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { extractFromImage } from '../cv/extractor';
import { nodeOcrProvider } from '../cv/ocrNode';
import { evaluateFixture, formatCorpusReport, missingImage, type FixtureOutcome } from './corpus';
import { CORPUS_CACHE, CORPUS_ROOT, loadCorpus, loadFixtureImage } from './corpus.node';

/**
 * Corpus regression run. By default only the generated pathological fixtures run (no
 * downloads, fast). `CORPUS=1` runs every fixture whose image is available — E2, synthetic,
 * and real-world plans fetched with `npm run corpus:fetch` — and writes REPORT.md.
 */
const ALL = loadCorpus();
const RUN_ALL = process.env.CORPUS === '1';
const fixtures = ALL.filter((f) => RUN_ALL || f.category === 'pathological');
const ocr = nodeOcrProvider();
const outcomes: FixtureOutcome[] = [];

afterAll(async () => {
  await ocr.dispose();
  const report = formatCorpusReport(outcomes);
  console.log(report);
  if (RUN_ALL) writeFileSync(join(CORPUS_ROOT, 'REPORT.md'), `${report}\n`);
});

describe('floor-plan corpus', () => {
  it('has well-formed fixtures with unique ids', () => {
    expect(new Set(ALL.map((f) => f.id)).size).toBe(ALL.length);
    for (const f of ALL) {
      expect(['e2', 'synthetic', 'real-world', 'pathological']).toContain(f.category);
      if (f.category === 'real-world') {
        // Real-world images are referenced, never committed: source and licence are required.
        expect('cache' in f.image).toBe(true);
        expect(f.source?.license).toBeTruthy();
        expect(f.source?.page).toMatch(/^https:\/\//);
      }
    }
  });

  for (const f of fixtures) {
    const available = !('cache' in f.image) || existsSync(join(CORPUS_CACHE, f.image.cache));
    if (!available) outcomes.push(missingImage(f));
    it.skipIf(!available)(
      `${f.category}/${f.id} meets its expectations`,
      async () => {
        const img = loadFixtureImage(f, ALL)!;
        const t0 = performance.now();
        const result = await extractFromImage(
          img,
          { id: f.id, file: `${f.id}.png`, mimeType: 'image/png' },
          { ocr },
        );
        const outcome = evaluateFixture(f, result, (performance.now() - t0) / 1000);
        outcomes.push(outcome);
        expect(outcome.checks.filter((c) => !c.pass)).toEqual([]);
      },
      300_000,
    );
  }
});
