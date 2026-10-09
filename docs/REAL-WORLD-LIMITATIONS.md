# Real-world limitations

What does **not** work today, and what could be done about it. Every "current limitation" below
was checked against the code or the corpus run (see [TESTING.md](TESTING.md)). Nothing here is
fixed unless the repository proves it.

Summary of where the extractor stands:
- **Clean plans with solid, filled walls** (estate-agent style, like E2): work well.
- **Most other real-world plans:** produce a model that needs review.
- **Very thin-line drawings with many candidates** (the `thin-line-drawing` rule; see
  [glossary](AI-CONTEXT.md#glossary)), **renders and noise:** fail safely; nothing is built.
  Line drawings whose walls are thin but solid, with fewer candidates (e.g. `tyneside-flat`),
  still extract, with review.

## Extraction

### Thin-line / outline walls

- **Current limitation:**
  - Walls are found as the thickest consistent ink (`walls.ts`). Plans that draw walls as two thin
    lines, outlines or hatching give a line-thin thickness class. Wall candidates then cannot be
    separated from furniture and text.
  - Above 200 candidates the extractor stops with `thin-line-drawing` (`structural_ambiguity`,
    `geometry-failure`). This is the largest failure class.
  - Corpus: `ballymun-flat-1965`, `floor-plan-01` and `coloured-3d-render` all end `failed` by
    this rule. `coloured-3d-render` passes the document check (`LIKELY`), but its only "thick"
    ink is about 4 px linework, with 620 candidates.
- **Future improvement:** detect walls as pairs of parallel lines with a consistent spacing, and
  fill between them, as a separate wall detector behind the same `DetectedWall` output.

### Dense, furniture-heavy plans

- **Current limitation:**
  - `structure.ts` removes detached, weak or glyph-like ink. Furniture drawn in heavy ink *and
    touching walls* survives, and splits rooms into spurious regions.
  - Corpus: the Grove flats report 2–2.25× the true room count. `massachusetts-ave-apartments`
    produces 133 rooms (3.3×).
  - These rooms are flagged (unlabelled; geometry confidence × 0.6 when they have no openings),
    but they are not removed.
- **Future improvement:** symbol and furniture recognition (template-based first; learned only
  once there is ground truth), or rejecting regions with no opening and no label below a size
  threshold. Needs corpus evidence first.

### Rotated and vertical text

- **Current limitation:** OCR reads horizontal lines only. Vertical room names and vertical
  dimension strings are ignored (for example on `tyneside-flat`).
- **Future improvement:** propose text regions in both orientations and OCR rotated crops.

### Non-Latin labels and languages

- **Current limitation:**
  - The Tesseract model is English only (`createWorker('eng', …)`).
  - The lexicon matches common French, German, Spanish, Italian and Dutch room words, but OCR
    accuracy on accented text is lower.
  - CJK, Cyrillic and Arabic labels are not read.
  - Units such as `pi` and `米` are not parsed.
- **Future improvement:** additional traineddata, loaded on demand, plus lexicon entries.
  Language detection from the page.

### Door symbols

- **Current limitation:**
  - Only hinged doors (leaf plus arc) and double doors (two arcs) are recognised.
  - Not recognised: sliding, bifold and pocket doors, and single leaves drawn without an arc
    (common in older plans, e.g. `tyneside-flat`).
  - A gap without a recognised symbol stays an uncertain `opening`.
  - The domain model supports `sliding` and `bifold`, but the extractor never produces them.
    The renderer draws a bifold leaf and shows a sliding door as an open gap.
- **Future improvement:** additional symbol detectors over the same gap candidates.

### Windows

- **Current limitation:**
  - A window needs ≥ 2 glazing lines inside the wall band, or a coloured band (`tintBands.ts`).
  - Thin-line windows inside thin-line walls inherit the thin-line failure.
  - On scans, glazing lines are often lost or doubled: on `e2-scan`, window precision is 23 %.
- **Future improvement:** more robust line detection on degraded images.

### Stairs

- **Current limitation:**
  - The `Stair` type exists, but reconstruction always produces `stairs: []`, the extractor does
    not detect stairs, and nothing renders them.
  - A stairwell is either a room (often "Unknown Room") or merged with a neighbour.
- **Future improvement:** stair detection (parallel tread lines plus an arrow), and a renderer.
  Multi-storey support depends on it.

### Fixtures and fittings

- **Current limitation:**
  - The extractor produces **no fixtures**: no baths, WCs, basins, counters or hobs. Every
    extracted plan raises `no-fixtures` (`missing-optional`).
  - Consequences:
    - furniture fitting on extracted plans does not avoid fixed fittings;
    - room classification never receives symbol evidence. `RoomEvidence.symbols` is supported,
      but never supplied.
  - Only hand-annotated plans (E2) have fixtures.
- **Future improvement:** fixture symbol detection, feeding both `fixtures[]` and classification.

### Curved walls

- **Current limitation:** walls are straight segments (`Wall.start`/`end`). Curved walls in an
  image become polylines at best, or are lost. There is no arc wall type in the model.
- **Future improvement:** an arc wall type in the domain model, plus fitting arcs in
  vectorisation. This needs a schema change and a migration.

### Undrawn boundaries

- **Current limitation:**
  - Boundaries are inferred only with evidence: sealing the outline, or separating two printed
    names. A cupboard without a drawn front merges into its neighbour. E2 shows this: its airing
    cupboard is missed.
  - Open-plan spaces are one room by design.
- **Future improvement:** user confirmation of proposed boundaries (Phase 5).

### Scale

- **Current limitation:**
  - Most real-world plans have no usable printed dimensions, so the scale is **estimated** from
    door widths (0.8 m) or wall thickness (0.25 m). It is always labelled ESTIMATED, with low
    confidence.
  - Noise destroys printed dimensions:
    - `e2-scan`: 10.3 % scale error;
    - `synthetic-mm-photo`: 7.2 %.
  - A misread single dimension can mis-scale a plan. `scale-implausible` only flags large
    disagreement with door widths.
- **Future improvement:** read scale bars and "1:100" notes, use more dimension strings, and give
  the reference-measurement correction a more prominent place in the UI.

### Merged walls

- **Current limitation:** a collinear run of wall merges into one wall with one `kind`. If part of
  it is external, the whole run is classed external (e.g. E2's kitchen nib).
- **Future improvement:** split walls where the exterior side changes.

### Performance and threading

- **Current limitation:**
  - The CV pipeline runs on the **main thread**, yielding between stages (`yieldToUi`). Tesseract
    runs in its own worker.
  - Images are reduced to 2400 px on the long side.
  - Timings:
    - E2: about 5–11 s in the browser;
    - large or dense plans: up to about 30 s (e.g. `e2-scan` 27 s in the browser test and
      30 s in the Node corpus run; Ballymun 27 s in the browser test).

    The UI stays responsive only between stages.
- **Future improvement:**
  - move the extractor into a Web Worker (it is pure TypeScript with no DOM dependency apart from
    image decoding);
  - optionally move it to a server behind `RemoteExtractionService`.

### Document check

- **Current limitation:** a heuristic over ink, straight lines, paper and specks. It rejects noise,
  blank pages and texture photos. A non-plan line drawing can pass it, and then normally fails
  later.
- **Future improvement:** more features, or a small learned classifier, once there is enough
  labelled data (see ROADMAP "Do NOT build yet"). It must stay "probable", never certain.

## Review and correction

### No review editor

- **Current limitation:**
  - The only correction available before accepting is the **scale reference**: "room N is X m
    wide" reruns the extraction.
  - The user cannot move, add or delete walls; split or merge rooms; confirm an inferred
    boundary; or add or move doors and windows.
  - After accepting, the model supports:
    - furniture edits;
    - renovation;
    - room rename;
    - door kind, material, width and height;
    - window kind, material, sill height and height;
    - **one structural correction (Phase 5, slice 1):** moving an interior wall sideways
      (`wall/move`).

    Exterior walls, wall endpoints, adding or deleting walls and openings, and splitting or
    merging rooms are not editable (see [DOMAIN-MODEL.md](DOMAIN-MODEL.md#editing-commands)).
- **Future improvement:** further Phase 5 slices; see [ROADMAP.md](ROADMAP.md).

### Room type cannot be changed by the user

- **Current limitation:**
  - There is no command to set `Room.type`. An "Unknown Room" can be renamed (`room/rename` →
    `labelSource` and `sources.name` become `user`), but its type stays `unknown`.
- **Future improvement:** a `room/retype` command with `user` provenance (Phase 5).

### Uploaded images are not persisted

- **Current limitation:** a saved project keeps the geometry only. After a reload, the 2D
  background and "Rebuild from floor plan" are unavailable until the image is imported again.
  `registerExtractedPlan` is in memory only.
- **Future improvement:** store images with the project (IndexedDB or a backend). Phase 6.

## Platform

| Area | Current limitation | Future improvement |
|---|---|---|
| Backend | No server, API routes or functions: `vercel.json` is static hosting. `RemoteExtractionService` is a client and contract only. Projects are saved to browser `localStorage` and JSON files. | A backend for persistence and, optionally, server-side extraction. Phase 6. |
| Storeys | `Apartment.floors[]` supports multiple storeys, but the UI, assistant and intents use `floors[0]`. | Depends on stair support and a floor switcher. |
| Furniture models | 20 parametric catalog items. glTF is supported by the renderer and catalog, but none are bundled. | Phase 7. |
| AI provider | The assistant uses the offline rule-based parser. The LLM JSON contract and `JsonIntentProvider` exist and are tested, but no LLM is wired in. `setIntentProvider` is never called, and there are no keys. | Phase 9, with transport server-side. |
| Material overrides | Renovation paths are unified (DECISIONS D21), but there is no per-door "chosen by the user" marker for materials, so a room or preset renovation overwrites a door finish picked individually. | Material provenance on doors and windows, if users need overrides to stick. |
| Layering enforcement | Enforced by ESLint and proven by `src/architecture.test.ts` (DECISIONS D2). It does not follow what allowed npm packages import transitively. | — |

## Corpus coverage gaps

- Real-world fixtures have **partial or qualitative** ground truth only:
  - counts;
  - room types;
  - printed labels;
  - expected status.

  No real-world plan has full geometric ground truth, so wall, door and window precision/recall
  and room IoU are measured only on E2, synthetic plans and images derived from them.
- 15 real-world plans, all from Wikimedia Commons. This is not a sample of any specific market,
  and three intended downloads (rate-limited) never became fixtures.
