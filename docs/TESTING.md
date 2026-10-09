# Testing and evidence

All numbers below were measured on 2026-10-08 at commit `ff164db` (branch `phase-5`). Re-run them
before trusting them. Nothing here was hand-edited to look better.

## Commands

| Command | What it runs | Network |
|---|---|---|
| `npm run check` | `tsc -b --noEmit` → `eslint .` → `prettier --check .` → `vitest run` → `tsc -b && vite build` | no |
| `npm test` | Vitest: all `src/**/*.test.{ts,tsx}` (Node environment, 30 s default timeout; corpus tests allow 300 s). Of the corpus, it runs only the 5 generated **pathological** fixtures, including `e2-scan` (about 30 s). | no |
| `npm run corpus:fetch` | Downloads the real-world corpus images into `tests/fixtures/floorplans/.cache/` (gitignored), verified by sha256 | **yes** (Wikimedia) |
| `npm run test:corpus` | `CORPUS=1` Vitest over every fixture whose image is available, then rewrites `tests/fixtures/floorplans/REPORT.md` | no (after fetch) |

## Current verified results

| Check | Result |
|---|---|
| `npm run check` | **passes**: typecheck, lint and format clean; **366 tests in 41 files pass**; production build succeeds |
| `npm run test:corpus` | **25 tests pass** (24 fixtures + 1 fixture well-formedness test); **95 / 95 expectation checks pass**; all 15 real-world images cached |
| Known regressions | **none** against Phase 4 expectations |

Build note: the `r3f` chunk is about 1.25 MB (343 kB gzip). It is within the configured
`chunkSizeWarningLimit` of 1600.

## Test suites by area

| Area | Files | What is covered |
|---|---|---|
| `src/domain` | 4 | geometry (concave polygons, intersection, overlap area), coordinates (pixel ↔ metre round trip), serialization plus **v1 → v2 migration of a real v1 save** (`__fixtures__/project-v1.json`), validation codes |
| `src/floorplan` | 3 | calibration (priority, outliers, confidence), reconstruction (synthetic plan, provenance of automatic rooms: `ocr`, Unknown Room), extraction service (local/remote contract, strict schema rejection) |
| `src/floorplan/fixtures/e2` | 3 | **fidelity**: annotations checked against the JPEG pixels. **reconstruction**: valid model, rooms, printed dimensions within 1 %, wall thickness, area cross-check, door connections and swings, assumptions, north, determinism. **extraction**: automatic extraction of E2 vs ground truth. |
| `src/floorplan/fixtures` | 2 | synthetic plans: ground truth valid; extraction recovers walls, rooms and openings, scale within 2 %, names; SVG rendering of test plans |
| `src/floorplan/cv` | 17 | every extractor stage: raster, morphology, walls, openings, railings, rooms (incl. `inferBoundaries`), text and lexicon, text regions, dimension lines, document check, structure filter, classifier, sanitiser, review statuses and components, metrics, robustness (polarity, tint, degradations), end-to-end extractor (stage order, failure on blank or strokes, `force`) |
| `src/floorplan/corpus` | 1 | fixture well-formedness (unique ids, licence and page for real-world plans) plus per-fixture expectations |
| `src/engine` | 3 | placement rules, fitting, scenario tests on E2 |
| `src/editor` | 1 | command application and immutability |
| `src/ai` | 3 | intents (rule-based parsing), suggestions, LLM JSON contract (rejection cases, `JsonIntentProvider`) |
| `src/state` | 1 | document store: dispatch, undo/redo, coalescing, rejection of edits that add validation errors |
| `src/persistence` | 1 | repository save, load and list |
| `src/scene/builders` | 1 | wall pieces, door leaves, polygon geometry, camera poses; the model contains no three.js objects |
| `src/ui` | 1 | 2D ↔ 3D selection sync (jsdom) |

Not covered by automated tests:
- `scene/builders/fixtureFrame.ts`;
- `scene/materialCache.ts`;
- dragging furniture in 3D (WebGL; the same `planTransform` path is tested numerically);
- the extraction review UI.

## Ground truth

- **E2** (`src/floorplan/fixtures/e2/annotations.ts`):
  - a hand-made annotation of `floor-plans/E2-floorplan.jpg` (1485 × 1080 px);
  - 10 rooms (4 unlabelled cupboards marked inferred), 24 walls, 10 doors, 4 windows,
    10 fixtures, printed dimensions;
  - calibrates to 88.15 px/m from 7 references (high confidence).
  - **Never edit it to make a test pass.**
- **Synthetic** (`synthetic/`, `synthetic-mm/`, `synthetic-corridor/`):
  - annotation-first plans; their images in `floor-plans/test/` are rendered from the
    annotations (`scripts/render-test-plans.ts`, headless Chrome/Edge);
  - they cover an angled wall, millimetre dimensions with grey walls and jambs, and a corridor
    with a railing and serif text.
- **Real-world:**
  - partial truth (room count, room types, printed labels, scale source) or qualitative
    (expected status or category), recorded by a person in each `fixture.json`;
  - no real-world plan has full geometric ground truth.

## Metrics (`src/floorplan/cv/metrics.ts`)

| Metric | Definition |
|---|---|
| Wall precision / recall | A truth wall is found when ≥ 80 % of its centreline is covered |
| Room detection / IoU | A room matches at IoU ≥ 0.5; mean and min IoU of matches |
| Label accuracy | Matched truth rooms with a printed label: extracted from a plan label with the same type |
| Classification accuracy | Matched rooms with the correct type |
| Door / window precision / recall | Matched within 0.6 m |
| Scale error | Relative error of px/m against the ground-truth scale |
| Partial (real-world) | Room-count ratio, type recall, label recall |

## Corpus results (current `REPORT.md`)

### Full ground truth

| Fixture | Status | Walls P/R | Rooms det. / IoU | Labels | Types | Doors P/R | Windows P/R | Scale err | Time |
|---|---|---|---|---|---|---|---|---|---|
| **E2** | ok-with-warnings | 100 / 96 % | 90 % / 0.987 | 100 % | 100 % | 100 / 90 % | 100 / 100 % | **0.04 %** | 5.5 s |
| synthetic-angled | ok-with-warnings | 100 / 100 % | 100 % / 0.996 | 100 % | 100 % | 100 / 100 % | 100 / 100 % | 0.25 % | 0.9 s |
| synthetic-corridor | ok-with-warnings | 100 / 100 % | 100 % / 0.997 | 100 % | 89 % | 100 / 100 % | 100 / 100 % | 0.21 % | 1.1 s |
| synthetic-mm | ok-with-warnings | 100 / 100 % | 100 % / 0.982 | 100 % | 100 % | 100 / 100 % | 100 / 100 % | 0.82 % | 1.3 s |
| e2-low-res (½ size) | needs-review | 91 / 83 % | 70 % / 0.917 | 80 % | 86 % | 100 / 70 % | 100 / 100 % | 2.73 % | 2.3 s |
| e2-scan (blur, noise, grey, vignette, specks) | needs-review | 85 / 88 % | 70 % / 0.862 | 100 % | 71 % | 80 / 40 % | 23 / 75 % | 10.31 % | 30.2 s |
| synthetic-mm-photo | needs-review | 89 / 89 % | 60 % / 0.869 | 0 % | 0 % | 33 / 20 % | 29 / 50 % | 7.17 % | 10.7 s |

- E2 misses three things:
  - the airing cupboard, whose front is not drawn, so it merges into the hall;
  - the bifold cupboard door;
  - the kitchen nib's wall kind.
- E2 and synthetic results are unchanged since Phase 3/4. They remain the regression baseline.

### Pathological

5 fixtures, generated at test time:
- 3 have full ground truth (scaled from E2 or synthetic) and appear in the table above:
  `e2-low-res`, `e2-scan`, `synthetic-mm-photo`;
- 2 are qualitative:

| Fixture | Status |
|---|---|
| noise | failed: stopped by the document check, one reason |
| blank | failed: same |

### Real-world (partial / qualitative truth)

| Fixture | Status | Rooms found | Room ratio / type recall / label recall |
|---|---|---|---|
| bungalow-2bhk (imperial) | needs-review | 8 | 0.8 / 86 % / 100 % (scale from printed ft-in) |
| tyneside-flat | needs-review | 8 | 0.57 / 60 % / 100 % |
| plan-appartement-fr | needs-review | 10 | 1.25 / 25 % / 100 % |
| schmidt-lademann-house | needs-review | 8 | 0.44 / 33 % / 90 % |
| kitchen-remodel-before (inverted) | needs-review | 9 | 1.13 / 67 % / 40 % |
| grove-1bed-flat | needs-review | 16 | 2 / 20 % / 71 % |
| grove-2bed-flat | needs-review | 10 | 1 / 33 % / 63 % |
| grove-3bed-flat | needs-review | 27 | 2.25 / 50 % / 43 % |
| massachusetts-ave-apartments | needs-review | 133 | 3.33 / 43 % / 25 % |
| plattenbau-p2 | needs-review | 2 | 0.2 / 17 % / 89 % |
| t-plus-128sqft-flat | needs-review | 1 | 0.5 / 0 % / — |
| hk-greenview-2bed | needs-review | 1 | qualitative |
| ballymun-flat-1965 | **failed** (thin-line) | 212 | qualitative (expected failure) |
| floor-plan-01 | **failed** (thin-line) | 114 | qualitative (expected failure) |
| coloured-3d-render | **failed** | 19 | qualitative (expected failed or needs-review) |

"Rooms found" is what the extractor produced, even for `failed` results. Those annotations exist
for review, but can never be accepted or built.

The corpus contains 24 fixtures:
- 1 E2;
- 3 synthetic;
- 15 real-world (Wikimedia Commons, CC BY-SA or public domain);
- 5 pathological.

Problems by category (fixtures affected / total problems). The report counts **warnings and
errors only** (`corpus.ts`), so info-level problems such as `no-fixtures` (`unsupported_symbol`)
and `non-structural-ignored` do not appear:

| Category | Fixtures / problems |
|---|---|
| wall_detection | 15 / 15 |
| room_detection | 11 / 40 |
| room_boundary | 13 / 155 |
| room_label | 17 / 447 |
| room_classification | 6 / 11 |
| door_detection | 19 / 1022 |
| window_detection | 8 / 34 |
| scale | 21 / 21 |
| annotation_conflict | 15 / 30 |
| image_quality | 2 / 2 |
| structural_ambiguity | 4 / 4 |

The committed `REPORT.md` at `ff164db` predates the final review change, under which the
not-a-floor-plan stop reports one reason only. Its problem counts for `room_detection`, `scale`
and `image_quality` were therefore slightly higher. The metrics were identical. The report was
regenerated on 2026-10-08.

## Browser testing

There is **no automated browser test in the repository**. On 2026-10-08 a scratch Playwright
script was run against `vite preview` with Chrome. The script lives in `.tmp/`, which is
gitignored and not committed. It covered six cases plus one extra plan:

| Case | Plan | Observed |
|---|---|---|
| Clean reference | E2 | ok-with-warnings, Accept enabled directly; 9 rooms in 2D and 3D, no validation errors (~11 s) |
| Missing labels | t-plus-128sqft-flat | needs-review; "Unknown Room (may be a bedroom, not assumed)"; acknowledged and built |
| Unusual walls | kitchen-remodel-before (white on grey) | needs-review; inferred boundaries drawn dashed; 9 rooms built |
| No explicit floor | tyneside-flat (line drawing) | needs-review; 8 rooms with derived floors in 2D and 3D |
| Scan-like | degraded E2 | needs-review; 13 rooms built (~27 s) |
| Scan-like, old | ballymun-flat-1965 | failed (thin-line); no Accept button; current model unchanged |
| Noise | generated noise | failed at the document check with one reason; "try anyway" still fails; nothing built |

Automating this flow (Playwright plus fixture images) is a reasonable addition before Phase 5 UI
work.

## Known weak areas (evidence)

- Real-world room counts are often wrong in both directions:
  - furniture creates extra regions (Grove 2–2.25×, Massachusetts 3.3×);
  - missed boundaries merge rooms (Plattenbau 0.2×, T-plus 0.5×).
- Type recall on real plans: 0–86 %.
- Scale is estimated on most real plans. 10 % error on the scan-like E2.
- Windows on scans: 23 % precision on `e2-scan`.
- Runtime: up to about 30 s on large or degraded images, on the main thread.

See [REAL-WORLD-LIMITATIONS.md](REAL-WORLD-LIMITATIONS.md).
