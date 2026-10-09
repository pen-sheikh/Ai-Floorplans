# Floor-plan extraction

How an uploaded image becomes `FloorPlanAnnotations`, and how the result is judged.
Code: `src/floorplan/cv/` (extractor), `src/floorplan/calibrate.ts`, `src/floorplan/extraction.ts`
(types and the `FloorPlanExtractor` boundary), and `src/floorplan/extractionService.ts` (the
service the UI calls).

Read [AI-CONTEXT.md](AI-CONTEXT.md) first. For the model this produces, see
[DOMAIN-MODEL.md](DOMAIN-MODEL.md).

## Boundary and contract

```
image (RgbaImage) ─► extractFromImage(img, source, options) ─► ExtractionResult
                                                                 ├─ annotations: FloorPlanAnnotations   (pixel space)
                                                                 ├─ stages[]      (status, ms, message per stage)
                                                                 ├─ confidence    (walls/doors/windows/rooms/calibration/overall)
                                                                 ├─ calibration   (strategy, px/m, confidence, basis)
                                                                 └─ review        (status, problems[], components, document)
```

- **Extraction stops at annotations.** It never builds the `Apartment`. After the user accepts
  the result, `buildApartment()` runs the same path that the hand-made E2 annotations use:
  `validateAnnotations → calibrate → reconstructApartment → validateApartment`.
- **Everything is in image pixels.** Coordinates are pixel *edges*. Only heights are in metres,
  and they are always recorded as assumptions.
- **No plan-specific logic.** Thresholds scale with the plan's own measured wall thickness
  (`profile.major` / `profile.minor`) and text height. The corpus has a rule against
  hard-coding names, sizes or coordinates of any fixture.
- **It is deterministic.** No LLM or remote model is involved. The same image and options give
  the same result.
- **Runtime:** pure TypeScript. It runs in the browser (main thread, yielding between stages)
  and in Node (tests, corpus).
- **Image size:** uploads are reduced to at most 2400 px on the longest side
  (`MAX_PLAN_SIDE_PX` in `loadImage.browser.ts`).

`CvExtractionOptions` covers:
- `ocr`: an `OcrProvider` (Tesseract in the browser or Node);
- `reference`: a known user measurement, `{ a, b, meters }`;
- `pixelsPerMeter`: a typed-in scale;
- `classifier`: a `RoomClassifier`;
- `force`: run even if the document check says "not a floor plan";
- `typicalDoorWidthMeters` (default 0.8) and `typicalExternalWallMeters` (default 0.25);
- `onProgress`.

## Pipeline (actual order in `extractor.ts`)

```
preprocess ─► document check ─► walls ─► openings ─► structure filter ─► coherence check
  ─► tint-band windows ─► OCR text ─► "text is not structure" ─► railings + rooms (+ inferred boundaries)
  ─► annotation walls / doors / windows ─► labels & dimensions into rooms ─► calibration
  ─► room geometry confidence ─► room classification ─► assemble ─► sanitise ─► review
```

Each stage below lists its input → output, what it is responsible for, its assumptions,
confidence/provenance behaviour, and its limitations.

### 1. Preprocess — `preprocess.ts`, `raster.ts`, `morphology.ts`

- **In → out:** `RgbaImage` → `Preprocessed`, which contains:
  - grey image;
  - binary ink mask;
  - Euclidean distance transform;
  - tint mask;
  - ink threshold.

  `wallThicknessProfile()` then gives `{ major, minor, modes }`.
- **Responsibility:**
  - Coloured *areas* (pixels whose 4 neighbours are also coloured, chroma ≥ 45) become paper,
    but are remembered in the **tint mask**. Dark coloured linework is kept.
  - Polarity is normalised: a drawing on a non-white ground is inverted only when its deviation
    from the ground is mostly *brighter* (white walls on grey).
  - Uneven backgrounds are flattened with a max filter when under 50 % of the image is paper.
  - Contrast stretch, Otsu threshold, then the exact EDT.
  - Wall thickness classes come from the stroke-width histogram of thick ink.
- **Assumptions:**
  - walls are the thickest consistent ink;
  - paper is the dominant light tone.
- **Confidence/provenance:** none. The stage only measures.
- **Limitations:**
  - Hatched or outline-only walls have no "thick ink", so the profile collapses to line width.
    This feeds the coherence check below.

### 2. Document check — `documentCheck.ts`

- **In → out:** `Preprocessed` → `DocumentCheck { verdict, confidence, evidence[] }`.
- **Responsibility:** answers "is this probably a floor plan?" from four measures:
  - ink fraction (plans: about 1–30 %);
  - share of straight H/V/diagonal runs;
  - plain-paper share relative to the paper level;
  - speck mass.

  It combines them as a geometric mean of band scores. The confidence is clamped to 0.03–0.97,
  so it is never certain. The verdict is:

  | Confidence | Verdict |
  |---|---|
  | ≥ 0.6 | `LIKELY_FLOOR_PLAN` |
  | ≥ 0.3 | `UNCERTAIN` |
  | below 0.3 | `UNLIKELY_FLOOR_PLAN` |
- **Behaviour:**
  - `UNLIKELY` (and no `force`): extraction stops. The result has empty annotations and exactly
    one problem, `not-a-floor-plan` (`image_quality`, `geometry-failure`), so the status is
    `failed`.
  - The UI offers "It is a floor plan — try anyway", which reruns with `force: true`.
  - `UNCERTAIN`: a `document-uncertain` warning is added, and the pipeline continues.
- **Limitations:**
  - It is a heuristic. It catches noise, blank pages and textures/photos.
  - A non-plan line drawing can pass it, and then normally fails later.
  - Remote results (`RemoteExtractionService`) are not document-checked.

### 3. Walls — `walls.ts`

- **In → out:** `Preprocessed` + profile → `DetectedWall[]` (`a`, `b`, `thickness`, `ends`,
  `coverage`, `confidence`) and a `wallMask`.
- **Responsibility:**
  1. Morphological opening keeps wall fill and short solid piers.
  2. Zhang–Suen skeleton → pixel graph → spur pruning → Douglas–Peucker simplification.
  3. Centreline and thickness are re-measured from perpendicular profiles.
  4. Collinear pieces are merged.
  5. L-corners and T-junctions are reconciled.

  Walls at any angle are supported.
- **Assumptions:** walls are solid filled strokes, much thicker than other linework.
- **Confidence:** per wall, from coverage and profile consistency.
- **Limitations:**
  - no curved walls (arcs become polylines at best);
  - thin-line or outline walls are not supported.

### 4. Openings — `openings.ts` (with `spatial.ts`)

- **In → out:** walls + grey image + wall mask → bridged walls and `DetectedOpening[]` (`door`,
  `window` or `opening`, with `doorKind`, hinge, side and `swingConfidence`).
- **Responsibility:** finds gaps between collinear walls, or from a wall end to a crossing wall,
  walking through short stubs. Gaps are split at piers. A gap becomes:

  | Detected as | Requires |
  |---|---|
  | `door` | a leaf line plus a swing arc around an empty sector |
  | double door | two arcs |
  | `window` | ≥ 2 glazing lines inside the wall band |
  | `opening` | nothing else matched: no recognised symbol |

  - Door width is measured between the drawn frames.
  - Doors drawn across solid fill must pass a smooth-arc test.
  - A solid-wall door scan runs only when the plan already has at least 2 hinged gap doors.
  - Processing uses a work queue, a `SegmentGrid` spatial index, and wall-end extension at most
    once per end. This keeps it near-linear on dense plans.
- **Confidence:** symbol strength per opening. `swingConfidence = clamp(1.5 × (1 − alt/best))`,
  comparing the best hinge/side fit with the best alternative.
- **Limitations:**
  - Only hinged and double doors are detected. Sliding, bifold, pocket doors and single leaves
    without an arc are not.
  - A doorway with no symbol stays an uncertain `opening`.

### 5. Structure filter — `structure.ts`

- **In → out:** bridged walls + profile → `{ walls (kept), removed, doubtful }`.
- **Responsibility:** separates structural walls from furniture, symbols, hatching and bold text
  using general features only:
  - thickness class fit (asymmetric: thinner is more suspicious than thicker);
  - connectivity (union-find over wall end contacts);
  - proportion (length / thickness);
  - size of the connected network relative to the largest.

  The removal rules are:

  | Removed | Condition |
  |---|---|
  | detached and weak pieces | network < 15 % of the largest |
  | isolated weak strokes | no connected ends |
  | glyph-like clusters | ≥ 3 strokes, compact, ≥ 70 % short, ≥ 1 oblique |

  - Strong detached pieces (piers cut off by undrawn openings) are kept as **doubtful**, with
    reduced confidence.
  - Openings on removed walls are dropped.
- **Review output:**
  - info `non-structural-ignored`;
  - warning `possible-annotation-walls` (`annotation_conflict`, `geometry-uncertain`), listing
    the doubtful ids.
- **Limitations:** furniture drawn as heavy, wall-connected ink survives. This is the main cause
  of spurious rooms on dense plans.

### 6. Coherence check (inside `extractor.ts`)

- `lineThin = profile.major ≤ max(5 px, 0.3 % of the short image side)`.
- If `lineThin` and there are more than 200 wall candidates → error `thin-line-drawing`
  (`structural_ambiguity`, `geometry-failure`). The drawing style is reported as unsupported;
  nothing is guessed.
- Otherwise, more than 600 candidates → warning `dense-drawing` (`geometry-uncertain`).

### 7. Tint-band windows — `tintBands.ts`

- **In → out:** tint mask + profile + wall mask → extra wall pieces (`tint{n}`) that each carry a
  window.
- **Responsibility:** handles windows drawn as coloured bands in the wall line, with no glazing
  lines.
  - Small holes in the tint mask (text inside a band) are filled.
  - The tint image is vectorised.
  - Bands are kept if their thickness is in [0.4 × minor, 1.6 × major], their length is
    ≥ 2 × thickness, and they touch structure.
  - Floor-sized colour areas are ignored.
- **Confidence:** capped at 0.7. An info problem `coloured-windows` is added. The window note
  says "Drawn as a coloured band".
- Skipped when the drawing is incoherent (step 6).

### 8. OCR text — `text.ts`, `textRegions.ts`, `ocrTesseract.ts`, `ocrBrowser.ts`, `ocrNode.ts`

- **In → out:** grey image + the OCR provider → `PlanText` (room-name candidates and dimension
  strings with boxes and confidences).
- **Responsibility:**
  - Offline Tesseract.js (LSTM, **English model only**). The browser serves its assets from
    `/ocr`, copied at build time.
  - A whole-page pass, plus a single-line read of each proposed text line on a text-only image.
    The more meaningful reading wins.
  - **Room names** are matched to a lexicon with bounded edit distance. It includes:
    - aliases and abbreviations: `MASTER BED`, `BED 1`, `BR`, `BDRM`, `WC`, `W/C`, `T&B`,
      `ENSUITE`, `LOUNGE`, `RECEPTION`, `UTILITY`, `STORE`, `WIC`, `KIT`…;
    - common French, German, Spanish, Italian and Dutch words, with accents stripped;
    - names with no model type (`STUDY`, `OFFICE`, `GARAGE`, `STAIRS`…), which keep their name
      with type `unknown`;
    - ambiguous words with low weight (`ZIMMER` 0.45).
  - **Dimensions** in metres, millimetres and feet/inches (`3.84m x 2.66m`, `4200 x 3100`,
    `12'7" x 8'9"`, `10 ft`). Metric wins when both are printed.
  - Without an OCR provider the stage is `skipped`. If OCR throws, it is `failed`, and
    extraction continues without text.
- **Confidence:** each match carries the OCR confidence × the word weight.
- **Limitations:**
  - no rotated or vertical text;
  - no non-Latin scripts;
  - units such as `pi` / `米` are not parsed;
  - very large display text may be skipped (proposals are capped at
    max(40 px, 3.5 % of the short side)).

### 9. "Recognised text is not structure"

Walls with both ends inside OCR name boxes are removed, and the wall mask is cleared inside those
boxes. This stops bold lettering from becoming walls.

### 10. Rooms and boundary inference — `rooms.ts`, `railings.ts`

- **In → out:** walls + railings + tint walls → `RoomSegmentation` (pixel regions → polygons),
  plus the inferred boundaries that were used.
- **API:** `segmentRooms(walls: DetectedWall[], width, height, majorThickness, wallMask?,
  { extraBarriers })`. It works on the internal `DetectedWall` type (`walls.ts`), not on
  `AnnotatedWall`, and it rasterises walls plus the optional wall mask. Re-using it on
  annotation-level edits would need an `AnnotatedWall` → `DetectedWall` conversion.
- **Responsibility:**
  - Railings (`railings.ts`) are two parallel thin lines with paper between them, both ends
    connected.
  - Walls are rasterised and closed across openings. Free regions not reachable from the image
    border are rooms. A room must have a minimum area and width (2 × max EDT ≥ 1.2 × major).
  - Boundaries are traced along pixel edges into polygons, and concave shapes are kept.
  - **Incomplete boundaries:** `inferBoundaries()` proposes closures within 12 × major, never
    crossing drawn ink. A free wall end may be joined:
    - to another free end ahead of it (±15°);
    - to another free end on an axis (within 10° of H/V, not behind it);
    - or extended to the wall ahead.

    A closure is kept only with evidence (`sealsOrSeparates`). Either it **seals** a region that
    leaked to the outside, or it **separates** two printed room names that shared one space.
  - Kept closures go into `annotations.inferredBoundaries` (with the gap length in metres).
    They are **never rendered as walls**; the room polygon simply follows them.
- **Confidence:**
  - `geometryConfidence = max(0.3, 0.95 − 0.9 × inferredShare)` of the outline.
  - A share above 5 % adds `inferred-room-boundary` (`room_boundary`, `geometry-uncertain`),
    giving the percentage and the longest gap.
  - Unlabelled rooms with no doors, openings or windows get geometry confidence × 0.6.
- **Limitations:**
  - Undrawn boundaries without that evidence are not recovered; a cupboard with no drawn front
    merges into its neighbour.
  - Heavy furniture can split rooms into spurious regions.

### 11. Annotation walls, doors and windows

- Each wall becomes an `AnnotatedWall` segment. It is exterior if one side is outside space, and
  tint walls are included.
- Openings become doors and windows on the host wall's dominant axis.
- Exterior status, footprint and envelope are derived from the room regions.

### 12. Labels and printed dimensions into rooms

- The OCR names inside each room are combined by `combineRoomNames()`:
  - kitchen/living/dining in one space → an open-plan type (`kitchen-living`);
  - any other combination → type `unknown` and a `merged-rooms` warning (`room_boundary`):
    "probably N rooms whose dividing wall was not found".
- Labels outside every room → `label-outside-rooms` (`room_detection`, `geometry-uncertain`).
- Room dimension pairs are matched to the room's extent. Single values are measured tick to tick
  along their dimension line (`dimensionLines.ts`).
- Room names: `match.display` (title case). Rooms without a name start as **"Unknown Room"**
  (`labelSource: 'unknown'`). If classification (step 14) then assigns a type on strong
  evidence, the room gets a generated name such as `Cupboard` or `Hall`, with
  `labelSource: 'inferred'`. Duplicate names are numbered.

### 13. Calibration — `calibrate.ts`

- **In → out:** room dimensions + references + manual/estimated scale → `ScaleCalibration`
  (`method`, `pixelsPerMeter`, `samples`, `maxResidual`, `confidence`, `basis`).
- **Priority:**
  1. explicit user reference;
  2. printed dimensions (median, ±3 % outlier rejection, mean of accepted samples);
  3. typed manual scale;
  4. estimate. The estimate is the median width of ≥ 2 detected hinged doors ÷ 0.8 m, or else
     the major wall thickness ÷ 0.25 m.
- **Confidence:**

  | Confidence | Requires |
  |---|---|
  | high | ≥ 3 agreeing references within 2 % |
  | medium | ≥ 2 references within 5 % |
  | low | single reference, manual, or estimate |

  - An estimate is always `method: 'estimated'` with low confidence, labelled **ESTIMATED** in
    the UI, with its `basis` recorded.
  - If all printed dimensions disagree, they are dropped and the next strategy is used (with a
    warning).
  - `scale-implausible` warns when printed dimensions imply doors more than 30 % away from the
    typical width. It never silently overrides them.
- **Limitations:**
  - Most real plans end up estimated.
  - Scan noise destroys printed dimensions: the E2 scan-like fixture has 10 % scale error.

### 14. Room classification — `classify.ts`

- **In → out:** `RoomEvidence` → `RoomClassification { type, confidence, labelConfidence,
  evidence[], suggestedType?, source }`.
- **Interface:** `RoomClassifier`. The default is `EvidenceRoomClassifier(assignAbove = 0.5)`.
  It is provider-agnostic: another classifier can be injected through `options.classifier`.
- **Evidence:**
  - OCR label;
  - area (and whether the scale is measured);
  - aspect ratio;
  - doors, windows and openings;
  - railing;
  - exterior share;
  - neighbours;
  - symbols. Note that the current extractor never supplies symbols, because fixtures are not
    detected.
- **With a label:** confidence = OCR confidence × word weight, × 0.6 if the size contradicts the
  label. The type is assigned if ≥ 0.35; otherwise it stays `unknown` with a suggestion.
- **Without a label:** only strong evidence assigns a type (a top score ≥ 0.5 and not contested
  within 0.1):
  - tiny windowless space with ≤ 1 door → storage, 0.6;
  - long space with ≥ 3 doors → hall, 0.6.

  Weaker cues only produce a `suggestedType`, which is never applied:
  - bathroom 0.35;
  - bedroom 0.38;
  - living 0.36;
  - railing → balcony 0.45.

  Scores × 0.85 when the scale is estimated.
- **Output:** `labelConfidence`, `classificationConfidence`, `classification.evidence` and
  `suggestedType` on the room. Overall room confidence = geometry × (0.7 if the type is unknown,
  else 0.7 + 0.3 × classification confidence).

### 15. Sanitise — `sanitize.ts`

- **In → out:** assembled annotations → `{ annotations, problems }`.
- **Responsibility:** the last line of defence, so that what reaches review and reconstruction
  is structurally valid. It drops:
  - walls without geometry;
  - openings on missing walls or mostly outside their wall (others are clamped);
  - invalid room polygons (`room-dropped`);
  - an invalid footprint (becomes `[]`) or envelope;
  - invalid fixtures.

  Overlapping openings of the same kind are merged. Otherwise they are ranked: door > window >
  opening, then by confidence.
- Every change becomes a problem (`annotation_conflict`).

### 16. Review — `review.ts`

See [Status model](#status-model-and-failure-behaviour) below. `assessExtraction()` turns
validation issues, stage problems and per-element confidence into `ReviewProblem[]`.
`assessComponents()` adds a per-component view. Confidence thresholds for flagging: walls, doors,
windows and rooms 0.6; door swing 0.5; room geometry 0.7.

## Three kinds of room confidence

| Field | Question it answers | Comes from |
|---|---|---|
| `geometryConfidence` | Is this space real and its outline right? | share of outline that was inferred; isolation (no openings) |
| `labelConfidence` | Was the printed name read correctly? | OCR confidence of the matched label (0 if none) |
| `classificationConfidence` | Is the room *type* right? | classifier over all evidence |

**An unknown room is still a room.** A space with a valid polygon but no readable label is kept
with `labelSource: 'unknown'`, name "Unknown Room" and type `unknown`. Its floor is derived from
its polygon like any other room. It raises `unnamed-room` (`room_label`, `semantic-uncertainty`):
"Room N has valid geometry but no readable label; kept as Unknown Room (it may be a X, not
assumed)". The suggestion is shown but never applied.

Provenance after reconstruction (`sources.name` / `sources.type`; full table in
[DOMAIN-MODEL.md](DOMAIN-MODEL.md#room-name-and-type-provenance-as-implemented-in-reconstructts)):

| Case | `labelSource` | `sources.name` | `sources.type` |
|---|---|---|---|
| automatic OCR names | `ocr` | `ocr` | `ocr` |
| generated names (classifier assigned a type to an unlabelled room) | `inferred` | `inferred` | `inferred` |
| unknown room | `inferred` | — | — |
| manual annotations | `plan-label` / `inferred`, as annotated | — | — |

## Status model and failure behaviour

Every `ReviewProblem` has:
- `severity` (`error` / `warning` / `info`);
- `code`;
- `category`;
- `impact`;
- `message`;
- optionally `elementId` / `elementIds`, used to highlight it on the overlay.

**Categories** (`EXTRACTION_ISSUE_CATEGORIES`): `wall_detection`, `room_detection`,
`room_boundary`, `room_label`, `room_classification`, `door_detection`, `window_detection`,
`scale`, `annotation_conflict`, `unsupported_symbol`, `image_quality`, `structural_ambiguity`.

**Impacts:**

| Impact | Meaning | Blocks acceptance? |
|---|---|---|
| `geometry-failure` | No valid 3D model is possible | **Yes** |
| `geometry-uncertain` | Geometry exists but may be wrong | Needs explicit acknowledgement (if severity is not `info`) |
| `semantic-uncertainty` | Geometry fine; meaning unsure | No |
| `missing-optional` | Not on the plan / not extracted | No |

**Every problem code** (severity / category / impact), from the code:

| Code | Severity | Category | Impact | Raised by |
|---|---|---|---|---|
| `not-a-floor-plan` | error | image_quality | geometry-failure | extractor (document check) |
| `thin-line-drawing` | error | structural_ambiguity | geometry-failure | extractor (coherence) |
| `no-rooms` | error | room_detection | geometry-failure | review |
| `annotation-<validation code>` | error / warning | by validation code | error → geometry-failure; warning → geometry-uncertain (`single-scale-reference` → semantic) | review (`validateAnnotations`) |
| `dense-drawing` | warning | structural_ambiguity | geometry-uncertain | extractor |
| `possible-annotation-walls` | warning | annotation_conflict | geometry-uncertain | extractor (structure) |
| `inferred-room-boundary` | warning | room_boundary | geometry-uncertain | extractor |
| `merged-rooms` | warning | room_boundary | geometry-uncertain | extractor (labels) |
| `scale-implausible` | warning | scale | geometry-uncertain | extractor |
| `room-dropped` | warning | room_boundary | geometry-uncertain | sanitise |
| `sanitized` | warning | annotation_conflict | geometry-uncertain (some opening merges: semantic-uncertainty) | sanitise |
| `low-confidence-walls` | warning | wall_detection | geometry-uncertain | review |
| `uncertain-room-boundary` | warning | room_boundary | geometry-uncertain | review (geometry confidence < 0.7) |
| `label-outside-rooms` | warning | room_detection | geometry-uncertain | review |
| `scale-estimated` | warning | scale | geometry-uncertain | review |
| `document-uncertain` | warning | image_quality | geometry-uncertain | review |
| `extractor-warning` | warning | structural_ambiguity | geometry-uncertain | review (free-text stage warnings) |
| `unnamed-room` | warning | room_label | semantic-uncertainty | review |
| `uncertain-room-label` | warning | room_label | semantic-uncertainty | review |
| `unclassified-label` | warning | room_classification | semantic-uncertainty | review |
| `unclassified-opening` | warning | door_detection | semantic-uncertainty | review |
| `possible-door` / `possible-window` | warning | door / window_detection | semantic-uncertainty | review |
| `uncertain-swing` | warning | door_detection | semantic-uncertainty | review |
| `dimension-mismatch` | warning | scale | semantic-uncertainty | review |
| `inferred-room` | info | room_classification | semantic-uncertainty | review |
| `dimension-reread` | info | scale | semantic-uncertainty | review |
| `coloured-windows` | info | window_detection | semantic-uncertainty | extractor |
| `non-structural-ignored` | info | structural_ambiguity | missing-optional | extractor |
| `no-fixtures` | info | unsupported_symbol | missing-optional | review |
| `scale-manual` | info | scale | missing-optional | review |

`info` problems never change the status.

**Status** (`ExtractionReview.status`, computed in `assessExtraction`):

```
any problem with impact geometry-failure                  → 'failed'
else any non-info problem with impact geometry-uncertain  → 'needs-review'
else any non-info problem                                 → 'ok-with-warnings'
else                                                      → 'ok'
```

**Acceptance** (`ExtractionDialog.tsx` + `acceptExtraction()` in `src/app/extractionActions.ts`):

| Status | UI label | Accept |
|---|---|---|
| `failed` | "No usable geometry" | Button hidden, and `acceptExtraction` returns early. No model is built; the current model is untouched. |
| `needs-review` | "Geometry needs review" | Disabled until the user ticks "I have checked the geometry items above". |
| `ok-with-warnings` | "Geometry OK · some details uncertain" | Enabled directly. |
| `ok` | "Ready" | Enabled directly. |

On accept, every non-info problem is appended to the **annotations'** `drawingNotes` as
"Extraction review: …". Reconstruction copies them into the model's `metadata.notes`, so they
remain visible in the Model tab.

`assessExtraction(annotations, calibration, context)` reviews **any** annotations. It does not
need the CV stages: `RemoteExtractionService` uses it on server output, with only `warnings` as
context. Stage problems (`thin-line-drawing`, `merged-rooms`, `inferred-room-boundary`…) exist
only when the extractor passes them in as `stageProblems`.

**Components** (`review.components`): `walls`, `rooms`, `roomLabels`, `doors`, `windows`, `scale`.
Each is `good` / `uncertain` / `missing` / `failed`, with a confidence and a summary. Walls and
rooms are `failed` when there are none, or when a geometry failure in their category,
`structural_ambiguity` or `image_quality` exists.

## Remote extraction (contract only)

`RemoteExtractionService` posts to an endpoint of this deployment and expects
`{ annotations, warnings? }`.
- `parseAnnotationsJson` (`annotationSchema.ts`) rejects unknown fields, wrong enums and
  non-finite numbers. Nothing is repaired.
- Calibration, confidence and review are recomputed client-side, so a server cannot declare its
  own result "ok".
- No server endpoint exists yet. The UI uses `LocalExtractionService`.

## Measuring it

`metrics.ts` compares extracted annotations with ground truth, in metres at the ground-truth
scale:

| Element | How it is matched |
|---|---|
| walls | covered ≥ 80 % (precision and recall; endpoint errors allow face-or-centreline slack) |
| rooms | IoU ≥ 0.5 (detection rate, mean/min IoU) |
| labels and types | label accuracy and classification accuracy on matched rooms |
| doors and windows | within 0.6 m (precision and recall) |
| scale | scale error |

See [TESTING.md](TESTING.md) for the current numbers.
