# Architectural decisions

Decisions made in Phases 1–4, with the reason and the consequence. When a decision changes, update
this file in the same change. Do not silently contradict it in code.

Format: **Decision**, then **Reason**, **Consequence**, and **Rejected** alternatives where
useful.

---

## D1. The apartment domain model is the single source of truth

- **Decision:** `src/domain/types.ts` (`Apartment`) holds all spatial truth. These all read it:
  - the 2D plan (`plan2d`);
  - the 3D scene (`scene`);
  - the furniture engine (`engine`);
  - renovation;
  - the assistant (`ai`).

  The scene builds three.js geometry from it in `useMemo` and never writes geometry back.
- **Reason:** several views and engines must agree. A renderer-owned model would make
  validation, persistence and AI impossible to keep consistent.
- **Consequence:**
  - 3D interactions only call stores. Selection lives in the scene store. A furniture drag calls
    `planTransform` → a `furniture/update` command.
  - A test asserts the model contains no three.js objects (`scene/builders/builders.test.ts`).
- **Rejected:** storing positions on three.js objects, or making the R3F scene graph the model.

## D2. The domain model is renderer- and framework-independent

- **Decision:** `src/domain`, `src/catalog`, `src/engine`, `src/editor`, `src/ai`,
  `src/floorplan` and `src/persistence` (the pure layers) import no React, three.js, React Three
  Fiber or zustand, and no presentation or app-state folder (`scene`, `plan2d`, `ui`, `app`,
  `state`). Production code in `src/domain` imports no other app layer at all.
- **Reason:** the logic stays testable in Node, and a future server or worker can run it.
- **Consequence:**
  - It is pure TypeScript with Vitest in a `node` environment.
  - **Enforced by ESLint** (`eslint.config.js`, part of `npm run check`):
    `@typescript-eslint/no-restricted-imports` covers `import`, `import type`, `export … from`
    and `import x = require()`; `no-restricted-syntax` covers dynamic `import()`.
  - `src/architecture.test.ts` lints probe files through the real config. It proves that
    forbidden imports are rejected and legitimate ones (domain-internal, UI using React) pass.
  - Limitations:
    - lint sees only this repository's import statements, not what an allowed npm package
      imports transitively;
    - tests inside `src/domain` may import fixtures from other layers;
    - `src/test` (test helpers) and `src/config` (the composition root) are not restricted.

## D3. All edits are serialisable commands

- **Decision:** model changes are `Command`s applied by the pure `applyCommand()`
  (`editor/commands.ts`). They are dispatched through the document store, which keeps snapshot
  undo/redo, coalescing and a Cancel baseline.
- **Reason:** undo/redo, validation of every edit, assistant execution and a path to
  collaboration or event-sourcing.
- **Consequence:**
  - New editing features (Phase 5) must add commands, not mutate state.
  - Geometry-touching commands are re-validated, and rejected if they add errors.

## D4. Geometry is deterministic; AI never produces geometry

- **Decision:**
  - Extraction (`src/floorplan/cv`), calibration, reconstruction, fitting and validation are
    deterministic algorithms.
  - No LLM or vision model decides wall positions, room polygons, scale or placements.
  - An LLM may only ever help with OCR clean-up of **names and labels**, or with semantics
    (names and types), behind validated contracts. It must never supply numbers that feed
    geometry or scale. Printed dimensions are read by the local OCR engine (Tesseract,
    deterministic for a given image) and pass the calibration checks (median, outlier
    rejection, door-width plausibility).
- **Reason:** spatial output must be reproducible, testable against ground truth and
  explainable. Generative output cannot be trusted as geometry.
- **Consequence:**
  - Same input → same result. Regressions are measurable.
  - Hard cases fail visibly instead of being "imagined".
- **Rejected:**
  - using an image-generation or vision model to produce the 3D apartment;
  - using an LLM to patch broken geometry.

## D5. AI produces structured intent, not scene manipulation

- **Decision:** natural language → `IntentProvider` → `Intent` JSON → `executeIntent` → engine
  (`fitFurniture`, `planPreset`) → `Command` → document store. The LLM contract
  (`ai/llmContract.ts`) is strict: `parseAssistantJson` rejects and never repairs. Unknown
  intents, keys, rooms, items or materials, and out-of-range values, are all rejected at once.
- **Reason:** the engine decides whether and where things fit. The AI cannot bypass collision,
  clearance or validation rules.
- **Consequence:**
  - The assistant never touches three.js.
  - Any provider (rule-based today, an LLM later via `JsonIntentProvider`) is interchangeable.
  - `executeIntent` re-validates every intent.

## D6. No API keys in the client; remote results are untrusted

- **Decision:**
  - The browser holds no credentials.
  - `RemoteExtractionService` may only call an endpoint of this deployment.
  - Its response must parse strictly as `FloorPlanAnnotations` (`parseAnnotationsJson`: unknown
    fields, wrong enums and non-finite numbers are rejected, never repaired).
  - Calibration, confidence and review are recomputed client-side.
  - The same applies to `JsonIntentProvider`: its transport is injected, and there are no keys.
- **Reason:** security, and a server must not be able to declare its own result "ok".
- **Consequence:** there is no server endpoint yet. Adding one requires keeping this contract.

## D7. Client-side, offline extraction by default

- **Decision:** `LocalExtractionService` runs the CV extractor and Tesseract OCR in the browser.
  The OCR worker, WASM core and English model are copied from `node_modules` to `/ocr` at build
  time (Vite plugin).
- **Reason:**
  - privacy (the image never leaves the device);
  - no backend required;
  - no CDN dependency.
- **Consequence:**
  - It runs on the main thread, taking about 5–30 s.
  - The OCR assets add about 14 MB to the deployment, fetched only on import.

## D8. Annotations are the extraction boundary; reconstruction is shared

- **Decision:**
  - Every extractor (hand-made, CV or remote) produces `FloorPlanAnnotations` in pixel space.
  - `buildApartment()` = `validateAnnotations → calibrate → reconstructApartment →
    validateApartment` is shared.
  - Reconstruction records `source.method` (manual → `plan-geometry`, automatic → `detected`),
    but never branches on it.
- **Reason:** one deterministic path from any interpretation to the model. Hand-made ground truth
  and extractor output are directly comparable.
- **Consequence:** new extractors only need to emit valid annotations. Metrics compare
  annotations with annotations.

## D9. E2 is a reference fixture, not production logic

- **Decision:**
  - `src/floorplan/fixtures/e2/annotations.ts` is hand-made ground truth.
  - E2 is the default *configured* plan (`config/plans.ts`, the composition root).
  - No extractor or engine code knows about E2 or any other plan.
  - **E2 ground truth is never edited to make tests pass.**
- **Reason:** E2 is the measuring stick. Changing it would hide regressions.
- **Consequence:**
  - `fixtures/e2/fidelity.test.ts` checks the annotations against the JPEG pixels.
  - Extraction accuracy is measured against them.

## D10. No plan-specific rules

- **Decision:**
  - Thresholds are relative to the plan's own measured wall thickness and text height.
  - No filename, coordinate, room name or size of any fixture or real-world plan may appear in
    extractor logic.
  - Corpus expectations are regression floors set from general behaviour, never targets met by
    special-casing.
- **Reason:** the goal is a general extractor. Per-plan patches overfit and hide the true
  failure rate.
- **Consequence:**
  - Some corpus plans still fail. That is recorded, not patched.
  - A grep of `src/floorplan/cv` for corpus fixture names finds nothing.

## D11. Floors are derived geometry

- **Decision:**
  - A plan never needs to draw a floor. The chain is walls → room polygons → per-room floor
    surfaces (and ceilings), with a slab from `floor.footprint`, or per room when there is no
    footprint.
  - Where a boundary is not drawn, a room is closed only by a recorded inferred boundary, and
    only with evidence.
- **Reason:** most real plans have no floor fill. Fabricating a boundary without evidence would
  present guesses as rooms.
- **Consequence:**
  - `inferredBoundaries` are stored with the annotations and drawn dashed in review. They are
    never rendered as walls.
  - They lower `geometryConfidence`.
- **Rejected:** closing every gap (it split E2's hall); flood-filling to the image border.

## D12. Geometry and meaning are judged separately

- **Decision:**
  - Rooms carry `geometryConfidence`, `labelConfidence` and `classificationConfidence`.
  - A room with a valid outline and no readable label is kept as **"Unknown Room"**, type
    `unknown`, with its floor.
  - Classification assigns a type only on strong, uncontested evidence. Otherwise it records a
    `suggestedType` that is not applied.
- **Reason:** a missing label is a semantic gap, not a geometry failure. Over-classification
  creates confident errors.
- **Consequence:**
  - Unknown rooms do not block acceptance (`semantic-uncertainty`).
  - `RoomClassifier` is an interface, so other classifiers can be plugged in.

## D13. Provenance and confidence are separate, and inference is never stored as fact

- **Decision:**
  - Provenance (per-property `sources`) records *where a value came from*.
  - Confidence (0–1) records *how sure an automatic producer is*.
  - Specific cases:
    - OCR-read names are `ocr`, not `plan-label`;
    - evidence-derived types are `inferred`;
    - fallback scales are `estimated`, with a basis;
    - heights not on the plan are `assumed`;
    - user edits are `user`.
- **Reason:** the UI must never present a guess as a measurement.
- **Consequence:**
  - New producers must choose provenance honestly.
  - Corrections (Phase 5) must record `user` provenance.

## D14. Extraction may be partial; failures are explicit and categorised

- **Decision:**
  - Every review problem has a category (12-value taxonomy) and an impact (`geometry-failure`,
    `geometry-uncertain`, `semantic-uncertainty`, `missing-optional`).
  - Status rules:
    - geometry failure → `failed` (no model; Accept is hidden);
    - uncertain geometry → `needs-review` (explicit acknowledgement);
    - semantics only → `ok-with-warnings` (accept directly).
  - A sanitiser removes structurally invalid elements and reports each removal.
- **Reason:** real plans rarely extract perfectly. Users need a usable partial model with honest
  flags, and must never get an invalid one.
- **Consequence:**
  - Accepted models carry their flagged problems: they are appended to the annotations'
    `drawingNotes`, which reconstruction copies into `metadata.notes`.
  - A failed extraction never replaces the current model.

## D15. "Is this a floor plan?" is probabilistic and stops early

- **Decision:**
  - The document check returns `LIKELY` / `UNCERTAIN` / `UNLIKELY` with a confidence clamped to
    0.03–0.97.
  - `UNLIKELY` stops extraction with one stated reason.
  - The user can force a run ("try anyway"), which is still reviewed normally.
- **Reason:** noise and photos produced spurious walls. Certainty claims would be wrong in both
  directions.
- **Consequence:** a non-plan line drawing can pass the check, and later stages must still fail it
  safely.

## D16. Unsupported drawing styles are reported, not guessed

- **Decision:** thin-line drawings with more than 200 candidate walls produce a
  `thin-line-drawing` geometry failure instead of a model.
- **Reason:** in that style, candidate walls cannot be told apart from furniture and text. A model
  built from them would be confidently wrong.
- **Consequence:** these plans fail until a thin-line wall detector exists.

## D17. Scale is data, with an explicit priority

- **Decision:**
  - Scale priority: user reference → printed dimensions (median, 3 % outlier rejection) → typed
    scale → estimate (door width or wall thickness).
  - Every sample is recorded. Estimates are labelled ESTIMATED with low confidence.
  - A suspicious printed scale is flagged, never silently overridden.
- **Reason:** a wrong scale silently corrupts every measurement and every fit.
- **Consequence:** `ScaleCalibration` carries method, basis, samples, residuals and confidence.
  The UI shows them.

## D18. Saves are versioned and migrated

- **Decision:**
  - Projects are saved as `{ format, schemaVersion, savedAt, apartment }`.
  - Loading runs ordered migrations (`domain/migrations.ts`), then full validation.
  - A real v1 save is a test fixture.
- **Reason:** user projects must survive schema evolution.
- **Consequence:** any schema change needs a migration, a version bump and a fixture/test.

## D19. Real-world regression corpus without committed images

- **Decision:**
  - Corpus fixtures (`tests/fixtures/floorplans`) commit manifests only.
  - Real-world images are openly licensed (Wikimedia Commons; licence, author and page are
    recorded). They are fetched into a gitignored cache and verified by sha256.
  - Pathological images are generated deterministically.
  - `npm test` runs only generated fixtures. `npm run test:corpus` runs everything.
- **Reason:** the repository must not depend on proprietary or user data, and default tests stay
  offline and need no downloads. The pathological set still includes
  `e2-scan` (about 30 s).
- **Consequence:** full corpus evidence requires `npm run corpus:fetch` (network) once.

---

## D20. Phase 5 corrections start as domain commands on the accepted model

- **Decision:**
  - The first correction (moving an interior wall sideways) is a `Command` on the canonical
    `Apartment` (`wall/move`), applied after an extraction is accepted. This is ROADMAP option
    B, scoped to one operation.
  - Dependent geometry is recomputed deterministically (`editor/wallMove.ts`):
    - the wall's ends slide along the walls they meet;
    - walls ending on it slide that end, and their openings keep their place;
    - room edges on both faces move, and corners are re-intersected;
    - topology is re-derived.
  - Changed walls and rooms are marked `user`; extraction confidences stay as an audit.
  - The operation refuses rather than approximates:
    - exterior walls and railings;
    - walls forming part of the building outline;
    - straight continuations with no crossing wall at the joint;
    - pinned or ambiguous junctions;
    - room edges that run on past the wall;
    - collapsed walls.
  - `planWallMove` then validates the whole model and refuses any new validation error. The
    document store applies the same gate again.
- **Reason:**
  - The accepted model is the source of truth (D1). Editing it reuses commands, snapshot
    undo/redo, validation and persistence (D3, D18) unchanged, with no schema change.
  - Annotation-level editing (option A) needs an annotation-format change and a
    re-segmentation path that does not exist yet.
- **Consequence:**
  - 2D and 3D update automatically, because both read the store.
  - Edits survive save and load.
  - Room polygons are edited in place, not re-segmented, so operations that change room
    *count* (split, merge) are not covered by this mechanism.
- **Rejected:**
  - moving exterior walls by also editing the footprint (later, with tests);
  - snapping or approximating ambiguous junctions;
  - letting an LLM or the assistant issue `wall/move` (the intent contract does not include it).

## D21. One renovation path; door and window finishes are applied to the doors and windows

- **Decision:**
  - `renovationCommands(apt, roomId, patch)` (`editor/operations.ts`) is the only way a room
    renovation becomes commands. The room panel, style presets and the assistant all use it.
  - A patch that sets `doorMaterialId` or `windowMaterialId` also updates
    `Door.materialId` / `Window.materialId` of every door and window of that room, because
    those are what the renderer draws.
  - A patch (or preset) without them leaves doors and windows alone.
  - A door shared by two renovated rooms takes the later room's finish.
- **Reason:**
  - Presets explicitly define door finishes (4 of 5) and window finishes (Industrial).
  - Before this, only the room-panel path propagated them, so a preset's "oak doors" never
    appeared in 3D.
- **Consequence:**
  - There is no per-door "user override" provenance for materials, so a later room or preset
    renovation overwrites a door finish picked individually in the inspector. This is the same
    behaviour the room panel always had.

## Open questions (not decided)

- Whether extraction should move to a Web Worker or a server (or both): Phase 6.
- Whether annotation-level correction *before* acceptance (ROADMAP option A) is still needed
  alongside D20's domain-level edits.
