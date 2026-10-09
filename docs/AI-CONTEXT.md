# AI project context — read this first

Canonical hand-off for any new session (human or AI). It is a summary of the repository, which
remains the source of truth. Last verified: 2026-10-09, on `43b5d4c` plus the uncommitted changes described below.

| Doc | Contents |
|---|---|
| [DOMAIN-MODEL.md](DOMAIN-MODEL.md) | entities, coordinates, provenance, persistence, commands |
| [FLOORPLAN-EXTRACTION.md](FLOORPLAN-EXTRACTION.md) | every extraction stage; the status and failure model |
| [TESTING.md](TESTING.md) | test suites, corpus, current verified numbers |
| [REAL-WORLD-LIMITATIONS.md](REAL-WORLD-LIMITATIONS.md) | what does not work, and what could be done |
| [DECISIONS.md](DECISIONS.md) | architectural decisions D1–D19, with reasons |
| [ROADMAP.md](ROADMAP.md) | phases, dependencies, what not to build; the Phase 5 proposal |
| `README.md` | user-facing usage and architecture overview |
| `overview.md` | plain-language explainer for non-engineers |

## Project goal

A web app that turns a **floor-plan image** into a **structured apartment model**, and from that
model into an **editable, interactive 2D/3D apartment**, where people can **place furniture**
(with real dimensions and clearance rules) and **renovate** rooms. An **AI assistant** helps with
both.

The long-term chain is:

```
floor-plan image → structured apartment model → editable 2D/3D apartment
→ furniture placement → renovation → AI-assisted interior design
```

**What exists today:**
- the whole chain, end to end, for clean plans;
- automatic extraction that is reliable for solid-wall estate-agent plans, and safe (it reviews
  or refuses) on harder ones;
- a rule-based assistant.

**Future work:**
- correcting extraction results by hand (Phase 5);
- production infrastructure (worker or server, backend persistence);
- realistic furniture assets;
- layout optimisation;
- an LLM-backed interior designer.

## Current phase

| Phase | Status |
|---|---|
| 1 — E2 reconstruction + interactive 3D | **complete** (PR #1) |
| 2 — Architecture hardening, furniture fitting, renovation, AI boundary, persistence | **complete** (PR #2) |
| 3 — Automatic floor-plan extraction MVP | **complete** (committed with Phase 2 in `433e24d`, PR #2) |
| 4 — Real-world robustness, corpus, confidence/provenance, safe failure | **complete** (`ff164db`, PR #3, merged to `main`) |
| 5 — Human-in-the-loop extraction correction | **IN PROGRESS**: slice 1 (move an interior wall on the accepted model) implemented; see ROADMAP.md and DECISIONS D20 |

- **Git:** branch `phase-5`. `ff164db` is the Phase 4 commit (merged to `main` as `a96a73c`);
  `43b5d4c` adds this documentation. On 2026-10-09 the following were implemented on top of it
  and left **uncommitted**:
  - the rename-provenance, renovation-path and layer-boundary fixes;
  - Phase 5 slice 1.

  **Always run `git status` yourself; this table goes stale.**
- **Stack:**
  - Vite 8, React 19, TypeScript 6, React Three Fiber (three.js 0.186), zustand 5;
  - Vitest 5, ESLint 10, Prettier 3;
  - tesseract.js 7 (offline OCR);
  - Node ≥ 22.12.
- **Deploy:** Vercel static hosting (`vercel.json`). There is no backend.

## Current capabilities (confirmed in code)

| Area | What works | Where |
|---|---|---|
| Floor-plan import | PNG, JPEG or WebP upload, decoded and reduced to ≤ 2400 px, processed **on the device** (about 5–30 s, on the main thread) | `app/extractionActions.ts`, `cv/loadImage.browser.ts` |
| Extraction | Deterministic CV pipeline: preprocess → document check → walls → openings → structure filter → tint-band windows → OCR → rooms with evidence-based boundary inference → calibration → classification → sanitise → review | `src/floorplan/cv/` |
| OCR | Tesseract.js, English model, offline (assets in `/ocr`). Room-name lexicon with aliases and EU-language words. Metric and imperial dimensions. | `cv/text.ts`, `cv/ocr*.ts` |
| Scale | Priority: user reference → printed dimensions (median, outlier rejection) → typed scale → **estimate** (labelled, low confidence) | `floorplan/calibrate.ts` |
| Review | Status `ok` / `ok-with-warnings` / `needs-review` / `failed`; 12-category taxonomy × 4 impacts; per-component status; problems linked to elements on an overlay; scale correction; "try anyway" for non-plans | `cv/review.ts`, `ui/ExtractionDialog.tsx` |
| Room reconstruction | Annotations (pixels) → `Apartment` (metres): walls at any angle, concave rooms, doors and windows on walls, fixtures, topology (`door.connects`, room refs) | `floorplan/reconstruct.ts`, `domain/topology.ts` |
| Confidence and provenance | Per-property `sources` (`plan-label`, `plan-geometry`, `detected`, `ocr`, `estimated`, `inferred`, `assumed`, `user`); per-entity confidence; room geometry, label and classification confidence; Unknown Room | `domain/types.ts`, `domain/provenance.ts` |
| 2D | SVG plan with the source image underlay; rooms, furniture and selection drawn in plan pixels | `plan2d/FloorPlan2D.tsx` |
| 3D | R3F scene built from the model: walls with opening cut-outs, animated door leaves, windows, derived floors, slab and ceilings, fixtures, furniture; camera modes perspective, top, room and exterior; 2D/3D/split views with shared selection | `src/scene/` |
| Furniture | 20-item parametric catalog. `checkPlacement`: 8 rules (room containment, wall/fixture/furniture collision, door swing and clearance, window access, front clearance). `fitFurniture` finds valid poses. Drag, nudge, rotate, duplicate. | `engine/`, `catalog/furnitureCatalog.ts` |
| Renovation | Per-room materials and colours (48 materials), lighting, 5 style presets | `catalog/materials.ts`, `catalog/renovationPresets.ts`, `room/renovate` |
| AI intent boundary | Rule-based NL → `Intent` → `executeIntent` → engine → `Command`. Strict LLM JSON contract (`parseAssistantJson`) and `JsonIntentProvider` exist and are tested; **no LLM is wired in, and there are no keys** | `src/ai/` |
| Editing | 9 serialisable commands (furniture add/update/remove, room renovate/rename, door/window update, **wall/move**, batch), snapshot undo/redo, Cancel baseline. Structural editing: only moving an interior wall sideways (Inspector "Correct wall position"; walls selectable in 2D and 3D). | `editor/commands.ts`, `editor/wallMove.ts`, `state/documentStore.ts` |
| Save/load | `localStorage` repository, JSON export/import, session restore; versioned project file with migrations (v1 → v2) and full validation on load | `persistence/`, `domain/serialization.ts`, `domain/migrations.ts` |
| Validation | `validateApartment`: ids, provenance, polygons, overlaps, walls, openings, fixtures, furniture. The 3D view pauses on errors. | `domain/validation.ts` |
| Corpus testing | 24 fixtures: e2, synthetic, real-world (15 openly licensed Wikimedia plans, cached by sha256) and pathological (generated). Metrics and `REPORT.md`. | `src/floorplan/corpus/`, `tests/fixtures/floorplans/` |

## Architecture

Simplified. The canonical stage order, with every intermediate step, is in
[FLOORPLAN-EXTRACTION.md](FLOORPLAN-EXTRACTION.md#pipeline-actual-order-in-extractorts).

```
image ─► preprocess ─► document check ─► walls ─► openings ─► structure filter ─► OCR
      ─► rooms (+ inferred boundaries) ─► calibration ─► classification ─► sanitise ─► review
      ─► FloorPlanAnnotations (pixels)                                  [src/floorplan/cv]
                     │  user accepts (blocked if failed; acknowledgement if needs-review)
                     ▼
      validateAnnotations ─► calibrate ─► reconstructApartment ─► validateApartment
                     ▼                                                  [src/floorplan]
            Apartment (domain model, metres)  ◄── THE SOURCE OF TRUTH   [src/domain]
                     │
   ┌─────────────┬───┴──────────┬────────────────┬─────────────────────────┐
   ▼             ▼              ▼                ▼                         ▼
 2D plan      3D scene     furniture engine   renovation           AI assistant
 [plan2d]     [scene]      [engine]           [catalog+commands]   [ai]: text → Intent → engine → Command
   └────────── reads only; all changes go through Commands → documentStore (undo/redo, validation) ──┘
```

| Stage | Responsibility |
|---|---|
| Preprocess | Colour areas → paper (kept as a tint mask); polarity and background normalisation; ink threshold; distance transform; wall thickness classes |
| Document check | "Probably a floor plan?" `LIKELY` / `UNCERTAIN` / `UNLIKELY` with a confidence (never certain). Unlikely stops early, unless forced. |
| Walls | Skeleton vectorisation of thick ink into centreline segments with thickness, at any angle |
| Openings | Gaps in walls → door (leaf + arc), window (glazing lines) or uncertain opening |
| Structure filter | Removes furniture, symbols and lettering by thickness fit, connectivity, proportion and network size. Thin-line drawings are reported as unsupported. |
| OCR | Room names (lexicon) and dimensions; recognised text is removed from structure |
| Rooms | Enclosed free regions → polygons. Open gaps are closed only with evidence and recorded as `inferredBoundaries`. |
| Calibration | px/m with an explicit priority. Estimates are labelled. |
| Classification | Room type from evidence. Unknown stays unknown; a suggestion is never applied. |
| Sanitise | Drops or merges structurally invalid elements, and reports each change |
| Review | Categorised, impact-ranked problems; component status; overall status |
| Reconstruction | Pixels → metres; provenance; assumptions; topology |
| 2D/3D, engine, AI | Consumers of the domain model |

## CRITICAL ARCHITECTURAL PRINCIPLE

> **THE APARTMENT DOMAIN MODEL IS THE SOURCE OF TRUTH.**
>
> - The extraction system produces **structured annotations** (`FloorPlanAnnotations`), never the
>   model and never rendering.
> - The reconstruction system produces the **domain model** (`Apartment`) deterministically.
> - 2D, 3D, furniture fitting, renovation and AI **operate against the domain model**. They read
>   it, and change it only through `Command`s.
> - **The 3D renderer must never become the source of spatial truth.** three.js objects are
>   derived and disposable.
> - **AI produces structured intent, not scene manipulation.** It never touches three.js objects,
>   and every intent is validated and executed by the deterministic engine.
> - **Geometry decisions remain deterministic.** No LLM or generative model decides walls, rooms,
>   scale or placements.

## DO NOT BREAK

These invariants are verified in the repository. Breaking one requires an explicit decision
recorded in DECISIONS.md.

1. **Never modify the E2 ground truth** (`src/floorplan/fixtures/e2/annotations.ts`) to make tests
   pass. It is checked against the image pixels (`fidelity.test.ts`).
2. **No plan-specific logic.** No filenames, coordinates, room names or sizes of any fixture or
   corpus plan in extractor or engine code. Thresholds scale with the plan's own measurements.
   E2 appears in production code only as the configured default plan (`config/plans.ts`).
3. **The domain model stays independent of React and three.js.** The same holds for every
   pure layer (`catalog`, `engine`, `editor`, `ai`, `floorplan`, `persistence`). This is enforced
   by ESLint and proven by `src/architecture.test.ts`. Do not weaken the rule to make an import
   pass: move the code to the right layer instead.
4. **The 3D renderer stays a consumer of the domain model.** Edits from 3D go through
   `planTransform` → commands → the document store.
5. **Geometry stays deterministic.** Extraction, calibration, reconstruction and fitting are pure
   algorithms. LLMs may only ever touch semantics.
6. **AI never directly controls three.js objects.** Intents are parsed strictly (reject, never
   repair) and executed through the engine and commands.
7. **No API keys in the client.** Remote extraction and LLM transport go through same-origin
   endpoints only, and their output is re-validated client-side.
8. **Never build a model from a `failed` extraction**, and never replace the current model with one.
   `needs-review` requires acknowledgement.
9. **Provenance must not be silently changed.** OCR is `ocr`, never `plan-label`; inferred is
   `inferred`; estimated scale is `estimated` with a basis; user edits are `user`.
10. **Confidence must not become false certainty.** No confidence of 1 for automatic output, the
    document check stays clamped (0.03–0.97), estimates stay labelled ESTIMATED, and
    suggestions stay unapplied.
11. **Unknown labels do not invalidate geometry.** A valid room without a readable label stays an
    "Unknown Room" with a floor.
12. **Existing features keep working:**
    - furniture fitting and placement rules;
    - renovation and presets;
    - save, load and migrations (the v1 fixture must still load);
    - 2D/3D selection sync;
    - the assistant flows.
13. **All tests pass:**
    - `npm run check` (typecheck, lint, format, tests, build);
    - the E2 and synthetic extraction tests;
    - corpus expectations (`npm run test:corpus`: 95/95 at last run).

    Corpus expectations are regression floors. Never loosen one, or special-case a plan, to make
    it pass.
14. **The real-world corpus stays regression coverage, without committed images.** Manifests
    only, licences recorded, and the cache verified by sha256.
15. **Schema changes need migrations**: a `SCHEMA_VERSION` bump, a migration in
    `domain/migrations.ts`, and a test. The annotation format has its own
    `ANNOTATION_FORMAT_VERSION`.

## Glossary

| Term | Meaning |
|---|---|
| **E2** | The reference plan `floor-plans/E2-floorplan.jpg` (Packenham House, Third Floor, 1485 × 1080 px). Hand-annotated ground truth in `src/floorplan/fixtures/e2/annotations.ts`; the default plan the app opens with. |
| **Annotations** | `FloorPlanAnnotations`: the pixel-space interpretation of a plan (walls, openings, **room polygons**, labels, dimensions, footprint, envelope, fixtures, calibration inputs). Produced by a person or by the extractor; the input to reconstruction. |
| **Footprint / envelope** | Footprint: the outer face of the external walls (slab outline). Envelope (`internalEnvelope`): the inner face of the external walls, used for the area cross-check. |
| **`profile.major` / `minor`** | The plan's measured wall thickness classes in pixels (thickest / thinnest). Every extractor threshold is relative to them. |
| **Thin-line drawing** | A plan whose thickest wall class is about line width (`major ≤ max(5 px, 0.3 % of the short side)`). With more than 200 wall candidates, it is reported as unsupported (`thin-line-drawing`). Plans with thin but solid walls and fewer candidates still go through. |
| **Pier / nib** | A short solid piece of wall (between openings, or a stub such as E2's kitchen nib). |
| **`planTransform` / `planPreset`** | Pure editor operations (`editor/operations.ts`): check a furniture move or resize against the engine and return a command (or none if blocked); build the batch of `room/renovate` commands for a style preset. |
| **`sealsOrSeparates`** | The evidence test for keeping an inferred boundary (seals a leak to the outside, or separates two printed names). |
| **`yieldToUi`** | `setTimeout(0)` between extraction stages, so progress renders on the main thread. |
| **Inferred boundary** | A room boundary closed across an undrawn gap, only with evidence. Stored in `inferredBoundaries`; never a wall. |
| **Unknown Room** | A room with valid geometry and no readable label: kept, with a floor, type `unknown`. |
| **Functional zones** | Engine zones around doors (swing, access) and windows (access) that furniture must respect (`engine/zones.ts`). |
| **Cancel baseline** | The model snapshot at load or last save; "Cancel" in the left panel reverts to it. |
| **Model tab** | Left-panel tab showing validation, scale calibration, assumptions and reconstruction notes (including accepted review problems). |
| **Rebuild from floor plan** | Model tab action: discard all edits and rebuild from the source annotations. Available for E2, and for an extraction accepted in the current session. |
| **Intent kinds** | Assistant intents: `place_furniture`, `check_fit`, `renovate`, `remove_furniture`, `describe_room`, `unknown` (`ai/intents.ts`). The LLM contract uses `fit_furniture` (translated to `place_furniture` on parsing), `check_fit`, `renovate`, `remove_furniture`, `describe_room`. Output it rejects becomes `unknown`. |
| **WIC / T&B** | Plan abbreviations matched by the lexicon: walk-in closet, toilet and bath. |

## Quick commands

```bash
npm install
npm run dev            # http://localhost:5173
npm run check          # typecheck + lint + format:check + tests + build (must pass)
npm run corpus:fetch   # download real-world corpus images into the gitignored cache (network)
npm run test:corpus    # run all corpus fixtures, rewrite tests/fixtures/floorplans/REPORT.md
```

On Windows Git Bash, heredocs with quotes are fragile. Write scripts to files instead.
`.tmp/` is gitignored scratch space.

## CLAUDE STARTUP PROTOCOL

Whenever a new Claude session begins work on this repository:

1. Read `docs/AI-CONTEXT.md`.
2. Read the relevant supporting documentation (DOMAIN-MODEL, FLOORPLAN-EXTRACTION, TESTING,
   REAL-WORLD-LIMITATIONS, DECISIONS, ROADMAP).
3. Inspect `git status` (and `git log --oneline -5`).
4. Inspect the relevant source code. Do not trust these documents over the code.
5. Run the relevant tests before modifying architecture (`npm run check`; `npm run test:corpus`
   when touching extraction).
6. Do not assume previous conversation context is available.
7. Treat the repository and these documents as the source of project history.
8. Update the documentation when an architectural decision changes (DECISIONS.md first).
9. Never use plan-specific hacks to make tests pass.
10. Before implementing a new phase, explain the proposed approach and identify possible
    regressions.
