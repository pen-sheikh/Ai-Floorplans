# AI Floorplans — 3D apartment reconstruction, furniture fitting & renovation

Turns the floor plan in `floor-plans/E2-floorplan.jpg` (Packenham House, Third Floor) into a
structured, validated apartment model, and renders it as an interactive 3D planner. You can
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
- **Assistant**: e.g. *"Put a 3-seat sofa against the longest wall in the living room"*,
  *"Can I fit a king-size bed in bedroom 1?"*, *"Renovate bedroom 2 with warm wood flooring and
  light beige walls"*. Each reply shows the structured intent it executed.

## Architecture

| Layer | Folder | Responsibility |
|---|---|---|
| Domain | `src/domain` | Typed model (`types.ts`), geometry, coordinate conversion, topology, validation, serialization + migrations. No React, no three.js. |
| Floor-plan reconstruction | `src/floorplan` | Pixel-space annotation of the plan → scale calibration → deterministic `reconstructApartment()`. |
| Catalogs | `src/catalog` | Material library, furniture catalog (real dimensions, asset abstraction, placement rules), renovation presets. |
| Engine | `src/engine` | `checkPlacement()` (room containment, walls, fixtures, furniture, door swings, clearances) and `fitFurniture(floor, roomId, requests, constraints)`. All constraints live in `constraints.ts`. |
| Editing | `src/editor` | Serialisable `Command`s applied by a pure `applyCommand()`, plus spatial operations (`planTransform`, `planAddFurniture`…) that return a command and a report. |
| State | `src/state` | Three separate stores: **document** (apartment + undo/redo history), **scene** (camera, selection, visibility, debug, constraints) and **UI** (tabs, dialogs, chat). |
| AI | `src/ai` | `Intent` types, `IntentProvider` interface, an offline rule-based provider, and `executeIntent()`, which validates intents and runs them through the engine. |
| 3D | `src/scene` | R3F components that only *read* the model. Pure builders (`builders/`) turn walls, openings, doors and polygons into mesh data and are unit-tested. |
| 2D | `src/plan2d` | The original plan image with room/furniture polygons drawn in plan pixels. |
| UI | `src/ui`, `src/app` | Figma-based shell (Property Scanner design tokens), panels, inspector, assistant, keyboard shortcuts. |
| Persistence | `src/persistence` | `ProjectRepository` interface + `localStorage` implementation, JSON export. |

### Coordinate system and scale

- 1 world unit = **1 metre**. The plan lies on the **X/Z** plane, and **Y is up**.
- Image +x → world +X; image +y (down the page) → world +Z. Viewed from above with −Z at the
  top of the screen, the 3D model reads exactly like the plan image (no mirroring).
- `world = (pixel − originPx) / pixelsPerMeter`. This conversion happens **only** in
  `src/domain/coordinates.ts`.
- Rotations follow three.js `rotation.y`: an item's front (local +Z) faces `(sin r, cos r)`.

**Scale is calibrated, not hard-coded.** `calibrate.ts` pairs each printed room dimension with
the drawn span it describes, takes the median px/m, rejects outliers (> 3 %) and averages the
rest. For E2 that gives **88.15 px/m from 7 printed dimensions, max deviation 0.6 %**.

### Model shape

`Apartment → floors[] → { rooms, walls, doors, windows, stairs, fixtures, furniture }`, with
`schemaVersion`, `metadata` (assumptions + reconstruction notes) and `coordinateSystem`.

- Rooms are polygons, which can be non-rectangular: Bedroom 2 is L-shaped, and the open-plan
  room has a notch for a wall nib.
- Walls are centrelines with thickness and height. Doors and windows reference a wall and an
  offset along it.
- Walls, doors and windows exist once on the floor; rooms reference them by id (`wallIds`,
  `doorIds`, `windowIds`), and these references are derived from geometry.
- Area and extents are **computed** from polygons, never stored, so they cannot drift.
- Each room has a `renovation` record (finishes and lighting), separate from its geometry.

### Why an annotation instead of image→3D

There was no extraction code in the repository, and an AI-generated model would not be
verifiable. The plan is therefore described once, in **pixel coordinates measured from the
image**, in `src/floorplan/annotations/packenhamHouseE2.ts`. Reconstruction is deterministic.
`annotationFidelity.test.ts` decodes the JPEG and checks that:

- every wall lies on wall fill;
- every opening is a gap;
- every room interior is clear.

So the annotation cannot silently drift from the plan. An automated extractor (vectoriser or
ML) only needs to output the same `FloorPlanAnnotation` format.

## What was extracted from the plan

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
  assets are supported through the catalog's `asset` field, but none are bundled.
- The assistant uses an offline rule-based parser. An LLM can be plugged in through
  `setIntentProvider()`; it must emit the same validated `Intent` JSON.
- Saving uses browser `localStorage` and JSON files. There is no backend yet.
- Single storey. The schema supports multiple floors and stairs, but the UI shows floor 0.

## Recommended next steps

1. **Automated extraction**: produce `FloorPlanAnnotation` from new uploads (wall
   vectorisation, OCR for labels and dimensions). Calibration, reconstruction and fidelity checks
   already exist.
2. **Larger catalog with glTF assets** (kitchen islands, vanities, showers).
3. **Smarter fitting**: functional zones, circulation paths between doors, multi-item layouts
   and scoring.
4. **Renovation presets and cost estimation** per room (areas are already computed).
5. **LLM intent provider** behind `IntentProvider`, using `buildIntentContext()` as the prompt context.
6. **Realistic materials**: PBR textures and HDRI lighting, measured for performance.
7. **Backend persistence** via `ProjectRepository`, attaching the apartment model to a property listing.
