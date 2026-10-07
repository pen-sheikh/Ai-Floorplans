/**
 * Render the synthetic test plans (ground-truth annotations → SVG → PNG) into floor-plans/test.
 * The PNGs are committed; re-run only when a synthetic fixture or the renderer changes:
 *
 *   node scripts/render-test-plans.ts            (Node ≥ 23 runs TypeScript directly)
 *
 * Rasterising uses a locally installed Chrome/Chromium/Edge in headless mode (set CHROME to
 * its path if it is not found). Nothing here runs in the app or in the test suite.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  renderPlanSvg,
  DEFAULT_PLAN_STYLE,
  type PlanStyle,
} from '../src/floorplan/fixtures/render/planSvg.ts';
import { SYNTHETIC_ANNOTATIONS } from '../src/floorplan/fixtures/synthetic/annotations.ts';
import {
  SYNTHETIC_MM_ANNOTATIONS,
  SYNTHETIC_MM_STYLE,
} from '../src/floorplan/fixtures/synthetic-mm/annotations.ts';
import {
  SYNTHETIC_CORRIDOR_ANNOTATIONS,
  SYNTHETIC_CORRIDOR_STYLE,
} from '../src/floorplan/fixtures/synthetic-corridor/annotations.ts';
import type { FloorPlanAnnotations } from '../src/floorplan/annotationTypes.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'floor-plans/test');

const PLANS: { ann: FloorPlanAnnotations; style: PlanStyle }[] = [
  { ann: SYNTHETIC_ANNOTATIONS, style: { ...DEFAULT_PLAN_STYLE, upperCaseNames: false, drawFixtures: true } },
  { ann: SYNTHETIC_MM_ANNOTATIONS, style: SYNTHETIC_MM_STYLE },
  { ann: SYNTHETIC_CORRIDOR_ANNOTATIONS, style: SYNTHETIC_CORRIDOR_STYLE },
];

function findChrome(): string {
  const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome/Chromium found; set CHROME=/path/to/chrome');
  return found;
}

mkdirSync(outDir, { recursive: true });
const chrome = findChrome();
for (const { ann, style } of PLANS) {
  const base = ann.image.file.replace(/\.png$/, '');
  const svgPath = resolve(outDir, `${base}.svg`);
  const pngPath = resolve(outDir, `${base}.png`);
  writeFileSync(svgPath, renderPlanSvg(ann, style));
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${ann.image.widthPx},${ann.image.heightPx}`,
      `--screenshot=${pngPath}`,
      pathToFileURL(svgPath).href,
    ],
    { stdio: 'ignore' },
  );
  console.log(`${ann.id}: ${pngPath}`);
}
