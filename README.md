# AI Floorplans — 3D apartment reconstruction, furniture fitting & renovation

Turns the floor plan in `floor-plans/E2-floorplan.jpg` (Packenham House, Third Floor), or a
floor-plan image you import (automatic extraction, reviewed before use), into a structured,
validated apartment model, and renders it as an interactive 3D planner. You can
furnish and renovate rooms, and an assistant turns natural language into structured edits.

```
floor plan image ─► annotation (pixels) ─► reconstruction (metres) ─► validated Apartment model
                                                                        │
                        ┌───────────────────────────────┬───────────────┼──────────────┐
                        ▼                               ▼               ▼              ▼
                   2D plan view                    3D scene      furniture engine   AI intents
                 (SVG over image)              (React Three Fiber)  (deterministic)  (structured)
```

The **Apartment model is the source of truth**. Both views render it. Every edit is a
serialisable command applied to it. three.js objects never hold model data.

## Run it

Requires Node 20+ (developed with Node 24).

```bash
npm install
npm run dev          # http://localhost:5173
npm run check        # typecheck + lint + format:check + tests + production build
```

Individual scripts: `npm run typecheck`, `npm run lint`, `npm run format` / `format:check`,
`npm test`, `npm run build`, `npm run preview`.

## Using the planner

- **2D / 3D / Split**: the segmented control at the top right. Selection is shared, so clicking a
  room on the plan highlights it in 3D and vice versa. Hovering a room on the plan shows
  *Click to room plan*, which opens the inside-room camera.
- **Camera**: Perspective, Top, Inside room (or double-click a floor), Exterior, Reset. Orbit,
  zoom and pan with the mouse; there are also +/− buttons.
- **Furniture tab**: click a card to add it. The fitting engine finds a valid spot in the
  selected room (or the best-matching room). Drag furniture in 3D to move it, or use the arrow
  pad. **R** / **Shift+R** rotates 15°, arrows nudge 5 cm, **Del** removes, **Ctrl+D**
  duplicates. Exact position, rotation and size are in the inspector.
- **Renovate tab**: wall/floor/ceiling/door/window finishes, wall colour, lighting and style presets.
- **Model tab**: validation status, the scale calibration table, assumptions and reconstruction
  notes. Everything the model does *not* know is listed here.
- **View tab**: plan-overlay opacity and position, debug layers (room polygons, wall centrelines
  and bounds, door swings, windows, ids, furniture bounds, collision/clearance zones) and
  placement constraints.
- **Toolbar**: ceilings on/off, plan overlay, dimension labels, day/night/interior lighting,
  undo/redo (**Ctrl+Z / Ctrl+Y**), save (browser storage, **Ctrl+S**), load, JSON export/import.
- **Import plan** (toolbar): choose a PNG, JPEG or WebP floor plan. It is extracted **on this
  device**; nothing is uploaded. The review shows:
  - walls, doors, windows and rooms drawn over the image;
  - counts with their confidence;
  - the scale and how it was obtained;
  - every problem the extractor could not resolve (click one to locate it on the plan).

  You can correct the scale with a known measurement ("Bedroom is 3.84 m wide"), which re-runs
  the extraction. **Accept** builds the 3D model through the normal pipeline. When the result
  needs review you must confirm you checked it; a failed extraction cannot be accepted.
- **Assistant**: e.g. *"Put a 3-seat sofa against the longest wall in the living room"*,
  *"Can I fit a king-size bed in bedroom 1?"*, *"Renovate bedroom 2 with warm wood flooring and
  light beige walls"*. Each reply shows the structured intent it executed.

## Architecture

```
  any floor plan ─► extractor (manual today, automatic later) ─► FloorPlanAnnotations
                                                                       │ validateAnnotations
                                                                       ▼
                                   calibrate ─► reconstructApartment ─► Apartment (schema v2)
                                                                       │ validateApartment
                     ┌─────────────────────┬──────────────────────────┼───────────────────┐
                     ▼                     ▼                          ▼                   ▼
                 2D plan view          3D scene              engine (placement,      AI: JSON contract
                 (plan2d)              (scene)               zones, fitFurniture)    → Intent → engine
                     └─────── selection/edits go through stores + Commands ──────────────┘
```

| Layer | Folder | Responsibility |
|---|---|---|
| Domain | `src/domain` | Typed model (`types.ts`), per-field provenance, geometry (concave-safe), coordinates, topology, validation, serialization and migrations. Depends on nothing else in the app: no React, three.js, DOM or catalogs. |
| Floor-plan pipeline | `src/floorplan` | Generic: the `FloorPlanAnnotations` format and its runtime schema (`annotationSchema.ts`), `validateAnnotations`, calibration, `reconstructApartment`, the extraction boundary (`FloorPlanExtractor`, `buildApartment`) and the extraction service (`extractionService.ts`). |
| Automatic extraction | `src/floorplan/cv` | Image → `FloorPlanAnnotations`: preprocessing, wall vectorisation, openings, railings, room segmentation, OCR text, dimension lines, calibration, confidence, review, and accuracy metrics. Pure TypeScript; runs in the browser and in Node tests. |
| Reference plans | `src/floorplan/fixtures/` | `e2/`: the real plan, with pixel-fidelity, reconstruction and **automatic-extraction** tests. Three synthetic plans (`synthetic/`, `synthetic-mm/`, `synthetic-corridor/`): their images in `floor-plans/test/` are rendered from their annotations by `scripts/render-test-plans.ts`. |
| Configuration | `src/config/plans.ts` | Composition root: which plans exist, the default plan, and catalog lookups injected into validation. |
| Catalogs | `src/catalog` | Material library, furniture catalog (real dimensions, asset abstraction, placement rules), renovation presets. |
| Engine | `src/engine` | `checkPlacement` (structural / furniture / functional-zone / clearance rules, each with a size in metres), `functionalZones` (door swing and access, window access), `fitFurniture` (+ `explainFit`), and memoised conflicts. Catalog is injectable. |
| Editing | `src/editor` | Serialisable `Command`s applied by a pure `applyCommand()`, plus spatial operations that return a command and a report. |
| State | `src/state` | **Document** (apartment, undo/redo with cached validation, baseline for Cancel), **scene** (camera, selection, visibility, debug, constraints), **UI** (tabs, dialogs, chat). |
| AI | `src/ai` | `Intent`/`AssistantIntent`, the rule-based provider, the **LLM JSON contract** (`parseAssistantJson`, strict and bounded), `JsonIntentProvider` (injected transport), and `executeAssistantIntent`. |
| 3D | `src/scene` | R3F components that only _read_ the model, with narrow store subscriptions. Shared materials and a shared unit box. Pure, unit-tested builders. |
| 2D | `src/plan2d` | The original plan with model polygons drawn in plan pixels; keyboard-accessible. |
| UI | `src/ui`, `src/app` | Figma-based shell, panels, inspector (with provenance details), assistant, shortcuts, session restore. |
| Persistence | `src/persistence` | `ProjectRepository` interface + `localStorage` implementation, JSON export. |

### Coordinate system and scale

- 1 world unit = **1 metre**. The plan lies on the **X/Z** plane, and **Y is up**.
- Image +x → world +X; image +y (down the page) → world +Z. Viewed from above with −Z at the
  top of the screen, the 3D model reads exactly like the plan image (no mirroring).
- `world = (pixel − originPx) / pixelsPerMeter`. This conversion happens **only** in
  `src/domain/coordinates.ts`.
- Rotations follow three.js `rotation.y`: an item's front (local +Z) faces `(sin r, cos r)`.

**Scale is data, not a constant.** References come from printed room dimensions or free-standing
dimension lines (any angle). Calibration takes the median px/m, rejects outliers (> 3 %) and
averages the rest, recording every sample and a **confidence**:

- **high**: at least 3 references agreeing within 2 %;
- **medium**: at least 2 references within 5 %;
- **low**: a single reference or a manual scale.

E2 calibrates to **88.15 px/m from 7 references (max deviation 0.6 %, high)**.

### Measured vs assumed (provenance)

Each wall, door, window, room and fixture records where each property came from (`sources`):

| Provenance | Shown as | Example |
|---|---|---|
| `plan-label` | known | a printed room size |
| `plan-geometry` | measured | a wall length at the calibrated scale |
| `detected` / `estimated` | estimated | automatic-extractor output, manual scale |
| `inferred` | inferred | an unlabelled cupboard, a doorless opening |
| `assumed` | assumed | ceiling 2.4 m, door 2.0 m, window sills |
| `user` | user | a sill height typed by the user |

Entities may also carry an extractor `confidence`. The inspector's **Details** section shows all
of this, and dimensions are formatted with "≈" and "(assumed)" from the data, never hard-coded.

### Model shape

`Apartment (schemaVersion 2) → floors[] → { rooms, walls, doors, windows, stairs, fixtures, furniture }`,
with `metadata` (assumptions, reconstruction notes, annotation source) and `coordinateSystem`.

- Rooms are any simple polygon, including concave ones (Bedroom 2 is L-shaped; the open-plan
  room has a nib notch).
- Walls are centrelines at any angle. Doors and windows reference a wall plus an offset along
  it; a window's head height is derived as sill + height.
- Walls, doors and windows exist once per floor. Rooms reference them by id, and those
  references are derived from geometry.
- Area and extents are computed, never stored.
- A room's `renovation` is separate from its geometry. Changing a finish is a command on the
  model, and the scene swaps a cached material.
- **Saves are versioned and migrated.** `src/domain/migrations.ts` upgrades v1 files (as saved
  by the first release) to v2. A real v1 save file is kept as a test fixture.

### Floor-plan pipeline and the extraction boundary

Every plan becomes `FloorPlanAnnotations` (image-pixel coordinates), whether a person
described it (`fixtures/e2/annotations.ts`, checked against the JPEG by
`fixtures/e2/fidelity.test.ts`) or the extractor read it from an image:

```ts
FloorPlanExtractor.extract(source) → { annotations, stages, warnings, confidence, calibration, review }
```

Everything after that is shared: `validateAnnotations → calibrate → reconstructApartment →
validateApartment`. Reconstruction records whether annotations were manual or automatic
(provenance `plan-geometry` vs `detected`) but never branches on it.

### Automatic extraction (`src/floorplan/cv`)

```
image ─► preprocess ─► walls ─► openings ─► railings ─► rooms ─► text (OCR) ─► dimensions ─► calibration ─► annotations ─► review
```

| Stage | Module | How |
|---|---|---|
| Preprocess | `preprocess.ts`, `raster.ts`, `morphology.ts` | Contrast stretch, Otsu ink threshold, exact Euclidean distance transform; wall thickness classes from the stroke-width histogram of the thick ink. Linear time. |
| Walls | `walls.ts` | Morphological opening keeps wall fill (and short solid piers); Zhang–Suen skeleton → pixel graph → spur pruning → Douglas–Peucker; centreline and thickness re-measured from perpendicular profiles; collinear merge; L-corners and T-junctions reconciled. Any angle. |
| Openings | `openings.ts` | Gaps between collinear walls, or from a wall end to a crossing wall (walking through short stubs); gaps are split at piers. A **door** needs a leaf line and a swing arc around an empty sector (double doors: two arcs); its clear width is measured between drawn door frames. A **window** needs ≥ 2 glazing lines inside the wall band (also when drawn in half the thickness). A gap with no symbol stays an **uncertain opening**. Doors drawn across solid fill must pass a smooth-arc test. |
| Railings | `railings.ts` | Two parallel thin lines with paper between them, both ends connected to walls or to another band. |
| Rooms | `rooms.ts` | Walls rasterised and closed across openings; free regions not reachable from the image border are rooms (minimum size and width); boundaries traced along pixel edges → polygons (concave shapes kept). Balconies and terraces are exterior rooms. |
| Text | `text.ts`, `textRegions.ts`, `ocrTesseract.ts` | Offline Tesseract (LSTM, English). A whole-page pass, plus a single-line read of every proposed text line on an image where everything except the glyphs is whitened; the more meaningful reading wins. Room names are matched to a lexicon with bounded edit distance (digit/letter confusions are used only for matching; the printed text is kept). |
| Dimensions | `text.ts`, `dimensionLines.ts` | `3.84m x 2.66m`, `4200 x 3100`, `12.00 m`… Pairs are matched to their room's extent; single values are measured tick to tick along the dimension line next to them. |
| Calibration | `../calibrate.ts` | Priority: a user reference measurement › printed dimensions (median, outliers rejected) › a typed scale › an **estimate** from typical door widths or wall thickness. An estimate is always labelled ESTIMATED with low confidence and is never presented as measured. A printed scale that implies implausible door widths is flagged. |
| Review | `review.ts` | Every uncertainty becomes a problem: low-confidence elements, symbol-less openings, unnamed or inferred rooms, labels outside any room, re-read or rejected dimensions, an estimated scale, validation errors. Errors (e.g. no rooms) → **failed**, and no 3D model is built. |
| Metrics | `metrics.ts` | Extracted vs ground-truth annotations, in metres at the ground-truth scale (see below). |

No stage knows any specific plan. All thresholds are relative to the plan's own measured wall
thickness and text height.

**Service boundary.** The UI uses `FloorPlanExtractionService` (`extractionService.ts`).
`LocalExtractionService` (the default) runs everything in the browser. The OCR worker, WASM
core and English model are served from `/ocr`, copied from `node_modules` at build time by a
Vite plugin (no CDN, no key). `RemoteExtractionService` posts the image to an endpoint **of this
deployment**, which may call a hosted vision model with credentials kept server-side; the
browser never holds keys. The reply must be `{ "annotations": FloorPlanAnnotations }`. It is
parsed strictly by `parseAnnotationsJson`: unknown fields, wrong enums or non-finite numbers are
rejected, never repaired. Calibration, confidence and review are then recomputed client-side, so
a server cannot declare its own output "ok". `VISION_EXTRACTION_INSTRUCTIONS` documents the
contract for a vision model, which only ever produces annotations, never geometry or rendering
instructions. No server endpoint ships yet.

**Running it on a file** (Node): `extractFromImage(loadImageFile(path), source, { ocr: nodeOcrProvider() })`.
**Regenerating the synthetic test images**: `node scripts/render-test-plans.ts` (uses a locally
installed Chrome/Edge in headless mode).

### Extraction accuracy

Ground truth is the hand-made annotations (E2's were not changed for this). A wall counts as
detected when ≥ 80 % of its centreline is covered by an extracted wall. At junctions, endpoint
errors accept either the centreline or the outer face. Rooms match at IoU ≥ 0.5, and doors and
windows within 0.6 m. Everything is in metres at the ground-truth scale. Reproduce with
`npx vitest run src/floorplan/fixtures --silent=false`.

| Plan | Scale error | Walls | Wall endpoint error (median / max) | Rooms (IoU mean / min) | Doors (width error, median) | Windows |
|---|---|---|---|---|---|---|
| **E2** (real, 1485×1080, 88 px/m) | **0.04 %** | **23/24** (95.8 %), 0 false | 1 mm / 66 mm | **9/10** (0.987 / 0.942) | **9/10**, 0 false (11 mm); swing + hinge 7/7 | **4/4**, 0 false |
| synthetic-angled (50 px/m, 45° wall) | 0.25 % | 9/9 | 3 mm / 97 mm | 2/2 (0.996) | 2/2 (5 mm) | 2/2 |
| synthetic-mm (60 px/m, grey walls, jambs, mm) | 0.82 % | 9/9 | 7 mm / 19 mm | 5/5 (0.982 / 0.977) | 5/5 (33 mm) | 4/4 |
| synthetic-corridor (40 px/m, railing, serif) | 0.21 % | 14/14 | 3 mm / 16 mm | 9/9 (0.997 / 0.977) | 9/9 (6 mm) | 6/6 |

E2 misses three things:
- the airing-cupboard front, which is not drawn on the plan, so the cupboard merges into the hall;
- the cupboard's bifold door;
- the kitchen nib's kind: it is merged with the collinear external wall and classed exterior.

Room names: all 9 matched rooms are labelled correctly. In the browser build, extracting E2
including OCR takes about 4–7 s.

### AI boundary

Natural language → `IntentProvider` → `AssistantIntent` → `executeAssistantIntent` → engine →
`Command`. An LLM plugs in via `JsonIntentProvider(complete)` and must answer with the JSON
contract in `src/ai/llmContract.ts`. `parseAssistantJson` rejects (it never repairs):

- unknown intents or fields, and unknown rooms, furniture or materials;
- out-of-range quantities and clearances;
- oversized payloads.

It reports every error at once, so the model can be re-prompted.

## What the E2 ground-truth annotations contain (described by hand)

| Element | Result |
|---|---|
| Rooms (labelled) | Bedroom ×2, Hall, Bathroom, Kitchen/Lounge/Diner, Balcony |
| Rooms (unlabelled, inferred) | 4 cupboards/wardrobe, marked "unlabelled" (enclosed spaces with doors) |
| Walls | 10 external (≈0.20 m), 11 internal partitions (≈0.10 m), 1 full-thickness nib, 2 balustrade lines; thickness measured |
| Doors | 10: 7 hinged (swing side and hinge from the arcs), 1 double wardrobe, 1 bifold, 1 open archway |
| Windows | 4 (2 bedrooms, kitchen north onto the balcony, kitchen east over the sink) |
| Fixtures | Bath, WC, basin, 4 kitchen-counter runs incl. peninsula, sink, hob, 1 unlabelled built-in |
| North | From the compass rose (used for the sun direction) |
| Stairs, columns, shafts | None drawn on this plan |

## Known limitations

### Automatic extraction

- **Readiness: prototype / internal beta.** It is measured on one real plan and three synthetic
  plans drawn by our own renderer. That is not evidence for arbitrary estate-agent plans, scans,
  photos or CAD exports: expect lower accuracy there, and always review.
- **Not handled yet**:
  - walls drawn as hatching or outlines only (apart from thin railings), and curved walls;
  - sliding and bifold door symbols, stairs, multi-storey sheets;
  - rotated text (vertical dimension strings are ignored), imperial-only plans, non-English labels;
  - fixtures and fittings: none are extracted, so furniture fitting does not avoid them.
- **Undrawn boundaries cannot be recovered.** A cupboard without a drawn front merges into the
  adjoining room. A doorway without a door symbol is kept only as an uncertain opening.
- **A merged wall has one kind.** A collinear run that is partly external is classed external.
- **Noise and photos.** The wall detector can find spurious "walls" in noisy images. Such
  results normally fail review because no rooms close, but there is no "is this a floor plan?"
  check.
- **A single printed dimension** means the scale cannot be cross-checked (this is flagged). An
  OCR misread of the only dimension would mis-scale the plan; a door-width plausibility check
  flags large errors.
- **It runs on the main thread.** Stages yield so progress stays visible. Images are reduced to
  2400 px on the longest side. The OCR assets add about 14 MB to the deployment and are fetched
  only when a plan is imported.
- **Uploaded images are not persisted.** A saved project keeps the geometry. After a reload, its
  2D background and "Rebuild from floor plan" are unavailable until the image is imported again.
- **No server-side extraction endpoint or vision-model integration is deployed.** The client and
  the contract exist.

### Model and planner

- **Heights are assumptions**: ceiling 2.4 m, doors 2.0 m, window sills and heads, balustrade
  1.1 m, fixture heights. None of these are on the plan; they appear in the Model tab and are
  shown as "assumed".
- **Bedroom 2's printed width (2.61 m) contradicts the drawing (≈2.82 m)**, and so does its
  imperial label (8'7"). The geometry is kept as drawn, and the label is excluded from
  calibration and flagged.
- **Total area**: the interior envelope measures ≈59.3 m² against the printed 57.4 m² (+3.3 %).
  Room floor areas total ≈56.7 m². The plan's own disclaimer says its figures are approximate.
- **Drawing quirks**: the balcony door and the kitchen window onto the balcony are drawn with
  wall fill across (part of) the opening. Both openings were taken from the jambs, swing arc
  and glazing lines, and are documented in `drawingNotes`.
- The 4 cupboards are unlabelled on the plan. Their names are inferred. The thin outline at the
  top-left of the kitchen is drawn without any label, so its purpose and height are unknown.
- Furniture models are parametric primitives (they rebuild exactly from real dimensions). glTF
  assets are supported through the catalog's `asset` field, but none are bundled Placement
  never depends on how an item is rendered.
- Only orthogonal fittings get detailed models; other fixture outlines render as extrusions.
- Renovation is per room. Per-wall-face finishes (accent walls) are not modelled yet.
- Dragging furniture in 3D is not covered by automated tests (WebGL in headless Chrome); the
  same `planTransform` path is tested via numeric moves, nudges and keyboard.
- The assistant uses an offline rule-based parser. An LLM can be plugged in through
  `setIntentProvider()`; it must emit the same validated `Intent` JSON.
- Saving uses browser `localStorage` and JSON files. There is no backend yet.
- Single storey. The schema supports multiple floors and stairs, but the UI shows floor 0.

## Recommended next steps

1. **Extraction**:
   - a corpus of real plans with ground truth (the metrics module is ready);
   - then fixtures, sliding and bifold doors, outline walls and rotated text;
   - a Web Worker, and persisting uploaded images;
   - an in-review editor (move a wall, rename a room) before accepting;
   - optionally a server-side vision model behind `RemoteExtractionService`.
2. **Larger catalog with glTF assets** (kitchen islands, vanities, showers).
3. **Smarter fitting**: functional zones, circulation paths between doors, multi-item layouts
   and scoring.
4. **Renovation presets and cost estimation** per room (areas are already computed).
5. **LLM intent provider** behind `IntentProvider`, using `buildIntentContext()` as the prompt context.
6. **Realistic materials**: PBR textures and HDRI lighting, measured for performance.
7. **Backend persistence** via `ProjectRepository`, attaching the apartment model to a property listing.
