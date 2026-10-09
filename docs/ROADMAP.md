# Roadmap

Product direction: **floor-plan image → structured apartment model → editable 2D/3D apartment →
furniture placement → renovation → AI-assisted interior design.**

## Done (verified against the repository)

| Phase | Scope | Where |
|---|---|---|
| 1 | E2 floor plan hand-annotated → reconstruction → interactive 3D apartment; 2D/3D/split views; Vercel deploy | `c381f0a`, PR #1 (`feature/3d-apartment-planner`) |
| 2 | Architecture hardening: domain model v2 with per-property provenance, migrations and validation; furniture fitting engine with functional zones; renovation and presets; command/undo architecture; AI intent boundary and strict LLM JSON contract; persistence (`ProjectRepository`) | `433e24d`, PR #2 (`feature/phase-2`) |
| 3 | Automatic extraction MVP: CV walls, openings, railings, rooms, offline OCR, dimension lines, calibration, review UI, metrics vs E2 and synthetic ground truth; extraction service boundary (local and remote contract) | `433e24d` (committed together with Phase 2), PR #2 |
| 4 | Real-world robustness: document check, structure filter, tint-band windows, polarity and background handling, evidence-based boundary inference, room classifier, sanitiser, failure taxonomy, impacts and statuses, component confidence, `ocr` provenance, Unknown Room handling, real-world and pathological corpus with `REPORT.md` | `ff164db`, PR #3 (`phase-4`), merged to `main` as `a96a73c` |

The current branch is `phase-5`, which points at `ff164db` (the same tree as `main`). **Phase 5
has not started.**

## Proposed sequence

This is a working plan, not a commitment. Revisit it after each phase.

| Phase | Theme | Depends on |
|---|---|---|
| **5** | Human-in-the-loop extraction correction | Phase 4 (review, taxonomy, provenance) |
| 6 | Production extraction infrastructure: Web Worker, optional server extraction, backend persistence, stored plan images | Phase 5's decision on whether projects store annotations or corrections (today they store only the `Apartment`) |
| 7 | Realistic 3D furniture and catalog (glTF assets, larger catalog) | Independent of 5/6. The renderer and catalog already support glTF. |
| 8 | Furniture layout optimisation (multi-item layouts, circulation, scoring) | Reliable room geometry (5); fixtures in extracted plans (an extraction improvement); a larger catalog (7) helps |
| 9 | AI interior designer (LLM behind `IntentProvider`, server-side transport) | Intent contract (done); server for keys (6); layout optimisation (8) for anything beyond single placements |

### Dependencies

```
4 ──► 5 (correction) ──► 6 (worker / backend / persistence of images & corrections)
                    └──► 8 (layout optimisation) ──► 9 (AI designer)
      7 (catalog/glTF) ──────────────┘                  ▲
      6 (server for LLM keys) ──────────────────────────┘
```

Extraction improvements continue alongside, driven by the corpus. They are not a numbered phase:
- thin-line wall detection;
- fixture and symbol detection;
- rotated text;
- door symbol variety;
- full ground truth for some real-world plans.

Fixture detection is a prerequisite for good layout optimisation on extracted plans.

## Do NOT build yet

| Item | Why |
|---|---|
| LLM-generated or LLM-corrected geometry | Violates D4. The LLM may only ever help with semantics. |
| A live LLM assistant in the client | Needs a server for keys (D6); the rule-based provider is enough until Phase 9. |
| Layout optimisation | Needs correctable geometry (5) and fixtures; otherwise it optimises against wrong rooms. |
| Backend persistence | Wait until Phase 5 defines what a project stores (corrections, images). |
| Multi-storey UI and stairs | No stair detection or rendering exists; single storey is the current product. |
| ML or learned extraction models (including a learned document check or furniture recogniser) | The corpus has no full real-world ground truth to train or measure against yet. REAL-WORLD-LIMITATIONS lists them as later options only. |
| Per-plan tuning to raise corpus numbers | Violates D10. |
| Curved walls | Needs a schema change and migration. There is no evidence yet that the target plans need it. |

---

## Phase 5 — Human-in-the-loop extraction correction (IN PROGRESS)

> **Slice 1 is implemented (uncommitted at the time of writing):** moving an interior wall
> sideways on the accepted model (`wall/move`; DECISIONS D20).
>
> Workflow: select a wall in 2D or 3D → Inspector "Correct wall position" → move towards
> either neighbouring room by N cm. Attached walls, both rooms' outlines, opening offsets and
> topology follow; the model is re-validated; changes are marked `user`; it is undoable and
> saved with the project.
>
> Everything else below is still a proposal. Option B was chosen for this slice (question 1
> below). Option A (annotation-level correction before acceptance) remains open for operations
> that change the number of rooms.

### Problem

Real-world extraction is usually `needs-review`:
- spurious or merged rooms;
- missed undrawn boundaries;
- symbol-less openings;
- unknown labels;
- an estimated scale.

Today the user can only correct the scale (and, after accepting, rename rooms and change some
door and window properties). They must accept a flawed model or reject it entirely.

### What exists to build on

| Existing piece | Where |
|---|---|
| Review overlay with element ids, highlight and problem → element links | `ExtractionDialog.tsx`, `ReviewProblem.elementIds` |
| Re-run with a user reference measurement | `rerunWithReference` |
| Pure annotation → model pipeline | `buildApartment` (validate → calibrate → reconstruct → validate) |
| Strict annotation schema | `annotationSchema.ts` |
| Sanitiser | `sanitize.ts` |
| Room segmentation from a wall list | `segmentRooms` in `rooms.ts`; deterministic, works on any `DetectedWall[]` |
| Recorded inferred boundaries | `inferredBoundaries` |
| Command/undo architecture on the domain model | `editor/commands.ts`, `documentStore` |
| `user` provenance | already used by `room/rename` and door/window edits |

Missing:
- any structural command (walls, room polygons, opening position or creation);
- room retype;
- any annotation-level editing;
- `sources.name` update on rename.

### Proposed scope

Before accepting, in the review step, on the annotation overlay:

1. **Walls:** move an endpoint or a whole wall; add a wall; delete a wall (e.g. furniture
   misread as a wall); change its kind (interior, exterior, railing).
2. **Inferred boundaries:** confirm one (it becomes a real boundary with `user` provenance),
   reject it, or draw a new one.
3. **Rooms:** split a room (draw a boundary) and merge rooms (remove a boundary). Both follow from
   wall and boundary edits plus re-segmentation. Also delete a spurious room.
4. **Room meaning:** rename; change type (new); accept the `suggestedType`.
5. **Doors and windows:** move along the wall; resize; add; delete; change kind (door, window or
   opening; hinged, double, sliding or bifold); flip hinge or swing.
6. **Scale:** keep the existing reference measurement, and allow it to be drawn on the plan.
7. **Revalidate after every edit:** sanitise → validate → calibrate → reconstruct → review. The
   status and components update live.
8. **Undo/redo** for correction edits.
9. **Provenance:** every corrected or added element is recorded as `user`, and keeps the
   original extractor confidence for audit. Nothing is silently converted to "measured".

After accepting (domain level, smaller):
- a `room/retype` command;
- `room/rename` also sets `sources.name = 'user'`.

### Key design decision to make first

Where should corrections live?

- **(A) Recommended: annotation-level corrections before acceptance.**
  - Corrections are commands on `FloorPlanAnnotations` (pixel space, the same overlay the
    review already draws).
  - After each edit, the shared deterministic pipeline re-runs, and rooms are re-derived from
    the corrected walls and boundaries via `segmentRooms`. This needs an `AnnotatedWall` →
    `DetectedWall` conversion, and a raster or wall mask: it rasterises walls and can use the
    extractor's wall mask. A split or merge is then just a boundary edit.
  - This reuses everything and keeps one reconstruction path (D8).
  - It needs:
    - a per-element `userCorrected` / provenance field in the annotation format (schema change:
      `ANNOTATION_FORMAT_VERSION` 2, plus parser support);
    - carrying user-confirmed labels and types across re-segmentation by matching regions.
- **(B) Domain-level structural commands after acceptance.**
  - This fits the existing undo store.
  - But moving a wall would not move the independent room polygons. It needs polygon
    regeneration, topology re-derivation (`deriveTopology`) and cross-entity consistency inside
    commands. This is much riskier for 2D/3D sync and for validation.

A hybrid is possible: (A) for structural correction, and simple domain commands (retype, rename)
after acceptance.

### Possible regressions to guard

- **E2 and synthetic extraction metrics and the corpus checks (95/95):** Phase 5 must not change
  extractor behaviour.
- **Accept rules:** a corrected result must still never build when geometry fails.
- **Save/load and migrations:** today projects store only the `Apartment`; annotations are never
  saved (bundled fixtures and in-session extractions only). If corrections are baked in at
  acceptance, saved apartments are unaffected. If Phase 5 decides to persist annotations or
  corrections, that is a new project-file field and needs a `SCHEMA_VERSION` bump and a
  migration. An annotation format v2 also affects the strict remote contract
  (`parseAnnotationsJson`).
- **Provenance honesty:** user edits must not erase or upgrade extractor provenance silently.
- **2D/3D selection sync and the furniture, renovation and assistant flows** on corrected models.
- **Performance:** re-running reconstruction per edit is cheap. Re-segmentation per edit must
  stay interactive on 2400 px images.

### Open questions to answer before implementing

1. **Corrections location:** A, B or hybrid (above).
2. **Failed results:** can the editor open on a `failed` extraction? `not-a-floor-plan` has empty
   annotations. A `thin-line-drawing` stage problem would persist even if a user redrew every
   wall: should user-drawn geometry clear it?
3. **Re-review after edits:** `assessExtraction` can review edited annotations, but extractor
   stage problems become stale. Which ones are kept, recomputed or dropped? Does the
   `needs-review` acknowledgement reset after each edit?
4. **Re-segmentation:** `segmentRooms` takes `DetectedWall[]` plus a raster. Edits on
   `AnnotatedWall` need a conversion. Should `inferBoundaries` re-run (it could re-propose a
   rejected boundary), or are boundaries user-owned after the first edit? How are labels, types
   and room ids carried across re-segmentation?
5. **Semantics of the edit operations:**
   - Is a confirmed inferred boundary a rendered wall, or a non-rendered boundary? How does it
     differ from "add wall"?
   - What does deleting a spurious room produce: a merge with its neighbour, or a void?
   - Moving an opening "along the wall": annotation spans are measured on the wall's
     **dominant axis** (`wallGeometry.ts` orients the wall so that coordinate increases a → b,
     and projects spans onto it). The editor must convert pointer positions the same way for
     angled walls.
   - Kind vocabularies: annotation doors use the domain `DoorKind` (`hinged`, `double`,
     `sliding`, `bifold`, `opening`) and windows use `WindowKind` (`standard`, `large`,
     `sliding-door`, `balcony-door`). The extractor only emits `hinged`/`double`/`opening`
     and `standard`.
6. **Provenance storage:** where per-element `user` provenance and the original extractor
   confidence live (annotation v2 fields). How reconstruction maps them, given that today it
   maps provenance per annotation set (D8).
7. **Display honesty:** `user` values show without "≈". A wall dragged on an *estimated* scale
   is not exact. Should geometry provenance stay `user` with a scale caveat, or is a separate
   marker needed?
8. **After acceptance:** correcting structure once furniture and renovation exist. Re-running
   reconstruction regenerates the model ("Rebuild from floor plan" discards all edits today).
   Preserve ids, re-attach furniture by room, or forbid structural edits after acceptance?
9. **Undo:** a second store for annotation edits, or a generic store? (`documentStore` is
   `Apartment`-specific.)
10. **Acceptance criteria:** target edit-to-feedback latency (measure `segmentRooms` and the
    pipeline on 2400 px images first), automated browser tests for the review flow, and
    corpus/E2 unchanged.

### Out of scope for Phase 5

- automatic re-extraction learning from corrections;
- server persistence;
- multi-storey;
- fixtures editing (fixtures are not extracted yet);
- LLM assistance.
