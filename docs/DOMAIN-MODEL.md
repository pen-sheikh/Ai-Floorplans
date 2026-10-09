# Domain model

The apartment model in `src/domain/types.ts` is **the source of truth** for every view and engine:
- the 2D plan;
- the 3D scene;
- furniture fitting;
- renovation;
- the assistant.

Renderers read it and never own geometry. `src/domain/` imports no React, three.js, DOM or
catalog code. This is a convention that the folder structure and tests uphold; ESLint does not
enforce it.

The examples below are real values from the E2 reference model (`loadKnownPlan()`), rounded and
trimmed.

## Coordinates and units

Defined in `src/domain/types.ts` (header comment) and `src/domain/coordinates.ts`. `coordinates.ts`
is the **only** place where pixels and metres are converted:

| Item | Convention |
|---|---|
| Units | 1 world unit = **1 metre** |
| Floor plane | **X/Z**: +X = plan right, **+Z = down the source image** |
| Vertical | **+Y = up** |
| Handedness | right-handed and un-mirrored: viewed from +Y with −Z at the top of the screen, the model reads like the image |
| Plan → world | `world.x = (px.x − originPx.x) / pixelsPerMeter`, `world.z = (px.y − originPx.y) / pixelsPerMeter` (`planToWorld`; reverse is `worldToPlan`) |
| Rotation | radians about +Y (three.js `rotation.y`); an item's front (local +Z) faces `(sin r, cos r)` |
| Wall frame | `d = normalize(end − start)`, normal `n = (−d.z, d.x)`; openings are positioned by `offset` along `d` |

`Vec2` is `{ x, z }` in metres. Pixel-space types live only in the annotation format
(`src/floorplan/annotationTypes.ts`, `PxPoint { x, y }`, pixel *edges*).

## Shape

```
Apartment (schemaVersion: 2)
├─ metadata        name, building, floorLabel, reportedAreaM2, annotationSource, assumptions[], notes[]
├─ coordinateSystem units 'meters', up 'Y', plan { image, originPx, calibration }, north?
└─ floors[]        (the UI uses floors[0]; multi-storey is schema-only)
   ├─ rooms[]      polygon + meaning + renovation; wallIds/doorIds/windowIds are DERIVED
   ├─ walls[]      centreline segments
   ├─ doors[]      on a wall (kind 'opening' = doorway without a leaf)
   ├─ windows[]    on a wall
   ├─ stairs[]     schema only — always empty today
   ├─ fixtures[]   fixed objects (bath, WC, counters…); furniture must not collide
   └─ furniture[]  placed catalog items
```

Walls, doors, windows, fixtures and furniture live on the `Floor` and are referenced from rooms by
id. A wall shared by two rooms exists once. Area, extents and head heights are **computed, never
stored** (`roomMetrics()` in `topology.ts`).

## Entities

### Apartment, metadata, coordinate system

```ts
const apartment: Apartment = {
  schemaVersion: 2,
  id: 'packenham-house-e2',
  metadata: {
    name: 'Packenham House — Third Floor',
    annotationSource: { method: 'manual', producer: 'hand-measured from image pixels' },
    reportedAreaM2: { value: 57.4, note: 'Printed on plan: "Approx. 57.4 sq. metres …"' },
    assumptions: [{ id: 'ceiling-height', description: 'Floor-to-ceiling height (not shown on plan)', value: 2.4, unit: 'm', source: 'assumed' }],
    notes: [{ code: 'scale-calibrated', severity: 'info', message: 'Scale 88.15 px/m from 7 printed dimension(s) (max deviation 0.6 %, high confidence).' }],
  },
  coordinateSystem: {
    units: 'meters',
    up: 'Y',
    plan: {
      image: { file: 'floor-plans/E2-floorplan.jpg', widthPx: 1485, heightPx: 1080 },
      originPx: { x: 237, y: 118 },
      calibration: {
        pixelsPerMeter: 88.153,
        method: 'dimension-labels', // 'reference' | 'dimension-labels' | 'manual' | 'estimated'
        samples: [{ referenceId: 'bedroom-1#0', roomId: 'bedroom-1', labelMeters: 3.84, measuredPx: 339, pixelsPerMeter: 88.281, residual: 0.001, accepted: true }],
        maxResidual: 0.006,
        confidence: 'high', // high: ≥3 refs within 2 %; medium: ≥2 within 5 %; low otherwise
      },
    },
    north: { x: 0.917, z: 0.4, source: 'plan-geometry' },
  },
  floors: [/* … */],
};
```

- `metadata.annotationSource.method` is `manual` (hand annotations such as E2) or `automatic`
  (the CV extractor; `producer: 'cv-extractor@2'`).
- `assumptions` lists every value the plan does not show (heights, sills).
- `notes` are reconstruction notes. An accepted extraction also adds its review problems to
  `drawingNotes`, and from there to the notes.

### Room

```ts
const bedroom: Room = {
  id: 'bedroom-1',
  name: 'Bedroom 1',
  type: 'bedroom', // living | kitchen | kitchen-living | dining | bedroom | bathroom | toilet | hall | balcony | storage | utility | unknown
  labelSource: 'plan-label',
  planLabel: { text: 'Bedroom', dimensionsText: '3.84m x 2.66m (12\'7" x 8\'9")', dimensions: [3.84, 2.66] },
  polygon: [{ x: 0.204, z: 0.204 }, { x: 2.87, z: 0.204 }, { x: 2.87, z: 4.05 }, { x: 0.204, z: 4.05 }], // inner faces; any simple polygon, concave allowed
  ceilingHeight: 2.4,
  exterior: false, // balcony/terrace: no ceiling
  sources: { geometry: 'plan-geometry', ceilingHeight: 'assumed' }, // + name/type when read or classified automatically
  wallIds: ['w-ext-north', 'w-ext-west', 'w-int-bed1-bed2', 'w-int-hall-north'], // derived
  doorIds: ['d-bed1'],
  windowIds: ['win-bed1'],
  renovation: { wallMaterialId: 'paint-white', floorMaterialId: 'floor-carpet', ceilingMaterialId: 'ceiling-white', trimMaterialId: 'wood-white', doorMaterialId: 'wood-white', windowMaterialId: 'upvc-white', lighting: 'warm' },
};
```

Fields used by automatic extraction (absent on E2):

```ts
const unknownRoom: Partial<Room> = {
  name: 'Unknown Room',
  type: 'unknown',
  labelSource: 'inferred', // annotation labelSource 'unknown' → domain 'inferred'; sources.name/type omitted
  geometryConfidence: 0.95, // is the space and outline right?
  labelConfidence: 0, // was a printed name read? (0 = none)
  classificationConfidence: 0, // is the type right?
  classification: { evidence: ['mid-sized room with a window and one door (≈ 11 m²)'], suggestedType: 'bedroom' }, // suggestion NOT applied
};
```

An automatically read name gives `labelSource: 'ocr'` and `sources.name/type = 'ocr'`.
`room/rename` sets `labelSource: 'user'`, but does not currently update `sources.name`. An
inferred E2 cupboard looks like this: `{ id: 'wardrobe-bed2', name: 'Built-in wardrobe', type:
'storage', labelSource: 'inferred' }`.

**The floor is derived from the room.** The 3D floor surface and ceiling are built from
`room.polygon`. The slab comes from `floor.footprint` when it has ≥ 3 points, and otherwise from
each room polygon (`scene/components/RoomSurfaces.tsx`). Nothing in the model stores a "floor
object".

### Wall

```ts
const wall: Wall = {
  id: 'w-ext-north',
  start: { x: 0, z: 0.102 }, // centreline, metres
  end: { x: 6.001, z: 0.102 },
  thickness: 0.204,
  height: 2.4,
  kind: 'exterior', // 'exterior' | 'interior' | 'railing'
  materialId: 'exterior-render', // base material where no room finish applies
  sources: { geometry: 'plan-geometry', height: 'assumed' },
  // confidence?: number — set for automatically detected walls
};
```

Walls are straight segments at any angle. Curved walls are not modelled. A railing is a wall of
kind `railing`, rendered as a balustrade.

### Door, and plain openings

There is **no separate Opening entity**. A doorway without a leaf is a `Door` with
`kind: 'opening'`.

```ts
const door: Door = {
  id: 'd-front',
  wallId: 'w-ext-south-hall',
  offset: 1.571, // wall.start → opening centre, along the centreline
  width: 0.76,
  height: 2,
  kind: 'hinged', // 'hinged' | 'double' | 'sliding' | 'bifold' | 'opening'
  hinge: 'start', // hinge end, in wall direction
  swingSide: -1, // side of the wall normal the leaf swings into
  materialId: 'wood-white',
  connects: ['hall', null], // rooms on the −n / +n side, DERIVED by deriveTopology
  sources: { geometry: 'plan-geometry', height: 'assumed', swing: 'plan-geometry' },
  note: 'Entrance door',
};
const doorway: Door = { ...door, id: 'd-kitchen', kind: 'opening', sources: { geometry: 'plan-geometry', height: 'assumed', swing: 'inferred' } };
```

### Window

```ts
const window: Window = {
  id: 'win-bed1',
  wallId: 'w-ext-north',
  offset: 1.526,
  width: 1.6,
  height: 1.2,
  sillHeight: 0.9, // head height = sill + height (derived, never stored)
  kind: 'standard', // 'standard' | 'large' | 'sliding-door' | 'balcony-door'
  materialId: 'upvc-white',
  sources: { geometry: 'plan-geometry', sillHeight: 'assumed', height: 'assumed' },
};
```

### Fixture

Fixed objects that furniture must not collide with.

```ts
const bath: Fixture = {
  id: 'fx-bath', roomId: 'bathroom', kind: 'bath', label: 'Bath',
  footprint: [{ x: 1.815, z: 5.808 }, { x: 2.462, z: 5.808 }, { x: 2.462, z: 7.464 }, { x: 1.815, z: 7.464 }],
  height: 0.55, elevation: 0, materialId: 'ceramic-white',
  sources: { footprint: 'plan-geometry', height: 'assumed' },
};
```

E2 has 10 hand-annotated fixtures. **The automatic extractor produces none.** Extracted plans
therefore have no fixtures, which is flagged in review as `no-fixtures`.

### Furniture

Real-world dimensions are the truth. The render scale is derived. The catalog is
`src/catalog/furnitureCatalog.ts`: 20 parametric items, with glTF supported but none bundled.

```ts
const sofa: FurnitureItem = {
  id: 'furniture-…', // newId('furniture')
  catalogId: 'sofa-3', name: '3-seat sofa', category: 'sofa',
  roomId: 'kitchen-living',
  position: { x: 7.2, z: 3.1 }, // footprint centre on the floor plane
  elevation: 0,
  rotation: Math.PI, // about +Y; front = local +Z
  dimensions: { width: 2.2, depth: 0.9, height: 0.85 },
  materialId: 'fabric-linen',
  // color?: '#rrggbb'
};
```

(The values above are illustrative: E2 ships with no furniture placed.)

### Renovation and materials

- Renovation is **per room**: `Room.renovation` holds wall, floor, ceiling, trim, door and window
  material ids, optional colours, and a lighting preset. There are no per-wall-face finishes.
- Materials are referenced by **string id** and resolved by `catalog/materials.ts` (48
  `MaterialDef`s). The renderer turns them into cached three.js materials in
  `scene/materialCache.ts`.
- There are 5 presets (`catalog/renovationPresets.ts`): `scandinavian`, `warm-modern`,
  `industrial`, `classic-luxe`, `bright-airy`.

## Provenance and confidence

They are **two separate concepts**:
- **Provenance** (`Provenance`, `sources` per property) says *where a value came from*.
- **Confidence** (`confidence`, `[0, 1]`, absent = not assessed) says *how sure an automatic
  producer is*.

| Provenance | Display class (`provenance.ts`) | Meaning |
|---|---|---|
| `plan-label` | known | printed on the plan, read by a person |
| `plan-geometry` | measured | measured from the drawing at the calibrated scale |
| `detected` | estimated | produced by the automatic extractor (geometry) |
| `ocr` | read | text read automatically — printed, but the reading may be wrong |
| `estimated` | estimated | heuristic or uncalibrated/manual scale |
| `inferred` | inferred | deduced from conventions (unlabelled cupboard, doorway swing, unknown room) |
| `assumed` | assumed | not on the plan; a documented default (heights) |
| `user` | user | entered or changed by a user |

- The UI formats lengths with "≈" for anything except `plan-label`/`user` (`units.ts`), and adds
  "(assumed)" etc. from the data.
- Reconstruction records automatic geometry as `detected` and manual geometry as
  `plan-geometry`, but never branches on it.
- Commands that change door/window dimensions mark the changed properties `user`.

## Annotations vs domain model

`FloorPlanAnnotations` (`src/floorplan/annotationTypes.ts`, `ANNOTATION_FORMAT_VERSION = 1`) is
the hand-off between *interpretation* and *reconstruction*. It is in pixel space (pixel *edges*)
and contains:

| Field | Contents |
|---|---|
| `walls[]` | `rect` (orthogonal solid wall) or `segment { a, b, thicknessPx }`; `kind` |
| `doors[]`, `windows[]` | `wallId` + `span` [from, to) along the wall's **dominant axis** (x if closer to horizontal, otherwise y); doors add `hinge: 'min' \| 'max'`, `swing` (image direction), `swingConfidence` |
| `rooms[]` | **Stored polygons** (`polygon: PxPoint[]`), `name`, `type`, `labelSource: 'plan-label' \| 'inferred' \| 'unknown'`, label text and printed dimensions, `exterior`, and the three confidences plus `classification` |
| `footprint`, `internalEnvelope` | Outer face (slab) and inner face (area cross-check) of the external walls |
| `fixtures[]` | `rect` or `polygon`, kind, height (empty for automatic extraction) |
| `labels[]`, `compass` | Text found on the plan; north |
| `calibration` | `references[]` (user reference / dimension lines), `manualPixelsPerMeter`, `estimatedPixelsPerMeter { value, basis }` |
| `defaults` | Assumed ceiling, door, railing, sill and head heights (metres) |
| `drawingNotes[]` | Drawing quirks, plus accepted review problems; reconstruction copies them into `metadata.notes` |
| `inferredBoundaries[]` | Closures across undrawn gaps; shown in review, **never rendered as walls** |
| `source` | `{ method: 'manual' \| 'automatic', producer, confidence }`, for the whole set |

There is **no per-element provenance** in the annotation format. Reconstruction derives provenance
from `source.method` (manual → `plan-geometry`, automatic → `detected`) and from `labelSource`.

`reconstructApartment()` (`src/floorplan/reconstruct.ts`) converts annotations deterministically
and throws `ReconstructionError` listing every annotation error. The steps are:
1. scale (`calibrateAnnotations` on the annotations' calibration block: the same function and
   inputs the extractor used for its report, so the result is the same; the model's copy is
   authoritative);
2. walls;
3. doors;
4. windows;
5. rooms;
6. fixtures;
7. area cross-check;
8. north;
9. `deriveTopology` (room refs and `door.connects`).

`buildApartment()` wraps validate → reconstruct → validate.

### Room name and type provenance (as implemented in `reconstruct.ts`)

| Annotation room | Domain `name` | `labelSource` | `sources.name` | `sources.type` |
|---|---|---|---|---|
| manual, `plan-label` | as printed | `plan-label` | — | — |
| manual, `inferred` (E2 cupboards) | as annotated | `inferred` | — | — |
| automatic, `plan-label` (OCR name) | display name | `ocr` | `ocr` | `ocr` (omitted if type `unknown`) |
| automatic, `inferred` (unlabelled, classifier assigned a type, e.g. storage or hall) | generated name (`Cupboard`, `Hall`…) | `inferred` | `inferred` | `inferred` |
| automatic, `unknown` (no label, no confident type) | **"Unknown Room"** | `inferred` | — | — |
| after `room/rename` | user's text | `user` | unchanged (not updated today) | unchanged |

`labelSource` answers "how was the name obtained". `sources.name`/`sources.type` are only
recorded for automatic annotations.

### Display of `user` provenance

`units.ts` omits "≈" for `plan-label` and `user`. A user-typed value is exact as entered. But a
geometry edit made on a plan with an **estimated** scale is still only as good as that scale.
Phase 5 must decide how such edits are displayed (see ROADMAP open questions).

## Schema version, persistence and migrations

| Item | Detail |
|---|---|
| Model version | `SCHEMA_VERSION = 2` |
| Project file | `{ format: 'ai-floorplans/apartment-project', schemaVersion, savedAt, apartment }` (`serialization.ts`) |
| Load sequence | `deserializeProject` parses JSON → checks the format → `migrateDocument` → `validateApartment`; any error-severity issue throws `ProjectLoadError` |
| Migrations | `domain/migrations.ts`, registry `{ 1: migrateV1ToV2 }` |
| v1 → v2 change | single `source` fields became per-property `sources`; calibration `confidence` and sample `referenceId`s were added |
| Test fixture | a real v1 save is kept at `src/domain/__fixtures__/project-v1.json` |
| Storage | `ProjectRepository` interface; only implementation `LocalStorageProjectRepository` (keys `ai-floorplans:projects`, `ai-floorplans:project:<id>`) |
| Export / import | JSON export via download, JSON import via file |
| Session restore | on start-up, reloads a saved project whose id equals the default plan's id (E2). Extracted models are not auto-restored; use Load. |
| Annotations | **not stored in projects.** Only the `Apartment` is saved. Annotations exist for bundled plans (E2) and, in memory for the session, for accepted extractions (`registerExtractedPlan`). |

**Uploaded plan images are not persisted.** A saved extracted model keeps its geometry. Its 2D
background and "Rebuild from floor plan" need the image to be imported again.

## Validation

`validateApartment(apartment, ctx)` (`domain/validation.ts`) returns issues with codes. The catalog
checks (`hasMaterial`, `hasCatalogItem`) are injected through `ValidationContext`; the app uses
`APP_VALIDATION` in `config/plans.ts`.

| Entity | Checks |
|---|---|
| Apartment | schema version, floors |
| All entities | missing or duplicate ids; missing provenance |
| Room polygons | vertices, NaN, area, self-intersection, duplicate vertices, ceiling height |
| Rooms | overlap > 0.02 m² |
| Walls | NaN, zero length, thickness, height |
| Walls | collinear overlap |
| Doors and windows | missing wall, width, height, outside the wall, too tall, overlapping on a wall, sill |
| Fixtures | footprint, height, room |
| Furniture | dimensions, transform, catalog item, room, outside its room |

`ok` means no error-severity issues. The 3D view pauses when there are validation errors, unless
the user chooses "Render anyway (debug)".

## Editing (commands)

All model changes go through `Command`s applied by the pure `applyCommand()`
(`editor/commands.ts`), dispatched via the document store (`state/documentStore.ts`). The store
provides:
- undo/redo as full snapshots, limited to 200;
- coalescing (a drag is one step);
- a baseline for Cancel.

The 8 commands are:

| Command | Effect |
|---|---|
| `furniture/add` | add a placed furniture item |
| `furniture/update` | change position, rotation, dimensions, material, colour, room, name or elevation |
| `furniture/remove` | remove an item |
| `room/renovate` | patch the room's `renovation` |
| `room/rename` | set the name; `labelSource: 'user'` |
| `door/update` | kind, material, width or height (dimension changes → `user` provenance) |
| `window/update` | kind, material, sill height or height |
| `batch` | apply several commands as one undo step |

**There are no structural commands.** Walls, room polygons, door/window positions, adding or
deleting openings, and room type cannot be edited. `door/update` and `window/update` re-validate,
and an edit that adds validation errors is rejected.
