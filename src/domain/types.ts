/**
 * Canonical apartment model.
 *
 * This is the single source of truth for every view (2D plan, 3D scene, AI layer,
 * furniture engine). Renderers consume it; they never own geometry.
 *
 * Coordinate system (see `coordinates.ts` for the conversion functions):
 *   - 1 world unit = 1 metre.
 *   - The floor plan lies on the X/Z plane. +X = plan right, +Z = plan down (towards the
 *     bottom of the source image). +Y = up. This is right-handed and un-mirrored: looking
 *     down from +Y with -Z at the top of the screen reproduces the source image.
 *
 * Normalisation: walls, doors, windows, fixtures and furniture live on the `Floor` and are
 * referenced from rooms by id. A wall shared by two rooms therefore exists exactly once.
 */

export const SCHEMA_VERSION = 2 as const;

/** A point on the floor plane, in metres. */
export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Where a value came from. Used to avoid presenting estimates as facts.
 *
 * | Provenance      | Meaning                                                    | Shown as  |
 * |-----------------|------------------------------------------------------------|-----------|
 * | `plan-label`    | Printed on the plan (text/dimension label)                 | known     |
 * | `plan-geometry` | Measured from the drawing at the calibrated scale          | measured  |
 * | `detected`      | Produced by an automatic extractor (carries a confidence)  | estimated |
 * | `estimated`     | Derived by a heuristic or from an uncalibrated/manual scale | estimated |
 * | `inferred`      | Deduced from drawing conventions (e.g. unlabelled cupboard)| inferred  |
 * | `assumed`       | Not on the plan; a documented default                      | assumed   |
 * | `user`          | Entered or changed by a user                               | user      |
 */
export type Provenance =
  'plan-label' | 'plan-geometry' | 'detected' | 'estimated' | 'inferred' | 'assumed' | 'user';

/**
 * Per-property provenance for an entity. Geometry measured from a plan and heights assumed
 * because the plan is silent can live on the same entity without being confused.
 */
export type Sources<K extends string> = Record<K, Provenance>;

/** Confidence in [0, 1] for detected/inferred entities. Absent = not assessed (manual data). */
export type Confidence = number;

export interface Assumption {
  id: string;
  description: string;
  value: number | string;
  unit?: string;
  source: Provenance;
}

export type IssueSeverity = 'error' | 'warning' | 'info';

/** Something noteworthy found while reconstructing the model from the plan. */
export interface ReconstructionNote {
  code: string;
  severity: IssueSeverity;
  message: string;
  entityId?: string;
}

export interface PlanImageReference {
  /** Repository-relative path of the source plan image. */
  file: string;
  widthPx: number;
  heightPx: number;
}

export interface ScaleCalibration {
  pixelsPerMeter: number;
  /**
   * reference: an explicitly given known measurement; dimension-labels: printed dimensions
   * (read by a person or detected by OCR); manual: a scale typed in by the user;
   * estimated: a fallback from typical sizes (e.g. door widths) — never exact.
   */
  method: 'reference' | 'dimension-labels' | 'manual' | 'estimated';
  /** What an estimated or manual scale was based on. */
  basis?: string;
  /** Each reference measurement compared with the drawing to derive the scale. */
  samples: ScaleSample[];
  /** Relative spread of accepted samples (max |residual|), e.g. 0.004 = 0.4 %. */
  maxResidual: number;
  /**
   * high: ≥ 3 agreeing references within 2 %; medium: ≥ 2 references within 5 %;
   * low: a single reference, a manual scale, or wide disagreement.
   */
  confidence: 'high' | 'medium' | 'low';
}

export interface ScaleSample {
  /** Id of the reference measurement (dimension label or dimension line). */
  referenceId: string;
  /** Room the reference belongs to, if it is a room dimension label. */
  roomId?: string;
  labelMeters: number;
  measuredPx: number;
  pixelsPerMeter: number;
  /** (measured − label) / label at the final calibrated scale. */
  residual: number;
  accepted: boolean;
}

export interface CoordinateSystem {
  units: 'meters';
  up: 'Y';
  /** Mapping from the source plan image to world coordinates. */
  plan?: {
    image: PlanImageReference;
    /** Image pixel that maps to world (0, 0). */
    originPx: { x: number; y: number };
    calibration: ScaleCalibration;
  };
  /** Unit vector pointing north on the X/Z plane, if the plan has a compass. */
  north?: Vec2 & { source: Provenance };
}

/** How the plan annotations behind this model were produced. */
export interface AnnotationSourceInfo {
  method: 'manual' | 'automatic';
  /** Tool or person, e.g. "hand-measured" or "wall-detector@0.3". */
  producer?: string;
  /** Overall confidence reported by an automatic extractor. */
  confidence?: Confidence;
}

export interface ApartmentMetadata {
  name: string;
  annotationSource?: AnnotationSourceInfo;
  building?: string;
  floorLabel?: string;
  /** Area quoted on the plan, if any. */
  reportedAreaM2?: { value: number; note: string };
  assumptions: Assumption[];
  notes: ReconstructionNote[];
}

export interface Apartment {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  metadata: ApartmentMetadata;
  coordinateSystem: CoordinateSystem;
  floors: Floor[];
}

export interface Floor {
  id: string;
  name: string;
  /** Building storey index (0 = ground). */
  level: number;
  /** Finished floor level in metres relative to this model's origin. */
  elevation: number;
  /** Default floor-to-ceiling height in metres. */
  height: number;
  heightSource: Provenance;
  /** Outer footprint of the unit (outer faces of the exterior walls), used for the slab. */
  footprint: Vec2[];
  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  windows: Window[];
  stairs: Stair[];
  fixtures: Fixture[];
  furniture: FurnitureItem[];
}

export type RoomType =
  | 'living'
  | 'kitchen'
  | 'kitchen-living'
  | 'dining'
  | 'bedroom'
  | 'bathroom'
  | 'toilet'
  | 'hall'
  | 'balcony'
  | 'storage'
  | 'utility'
  | 'unknown';

export interface RoomLabel {
  /** Text exactly as printed on the plan. */
  text: string;
  /** Printed dimensions, if any (metres, in printed order). */
  dimensions?: [number, number];
  dimensionsText?: string;
}

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  /** How the name/type was determined. */
  labelSource: Provenance;
  planLabel?: RoomLabel;
  /** Interior floor footprint (inner faces of the bounding walls). Simple polygon, any winding. */
  polygon: Vec2[];
  ceilingHeight: number;
  /** Open to the sky (balcony/terrace): no ceiling. */
  exterior: boolean;
  sources: Sources<'geometry' | 'ceilingHeight'>;
  confidence?: Confidence;
  /** Derived references (rebuilt by `deriveRoomRefs`). */
  wallIds: string[];
  doorIds: string[];
  windowIds: string[];
  renovation: RoomRenovation;
}

export type WallKind = 'exterior' | 'interior' | 'railing';

export interface Wall {
  id: string;
  /** Centreline start/end in metres. */
  start: Vec2;
  end: Vec2;
  thickness: number;
  height: number;
  kind: WallKind;
  /** Base material id when no room finish applies (e.g. exterior face). */
  materialId: string;
  /** `geometry` covers centreline and thickness; `height` is usually assumed. */
  sources: Sources<'geometry' | 'height'>;
  confidence?: Confidence;
}

export type DoorKind = 'hinged' | 'double' | 'sliding' | 'bifold' | 'opening';

/**
 * Openings are positioned along their host wall.
 *
 * `offset` = distance from wall.start to the opening centre along the centreline.
 * Wall direction d = normalize(end − start); wall normal n = (−d.z, d.x).
 */
export interface Door {
  id: string;
  wallId: string;
  offset: number;
  width: number;
  height: number;
  kind: DoorKind;
  /** Which end of the opening carries the hinge, in wall direction. Ignored for 'opening'. */
  hinge: 'start' | 'end';
  /** Side of the wall (along the normal n) the leaf swings into: +1 or −1. */
  swingSide: 1 | -1;
  materialId: string;
  /** Rooms on the −n and +n side, resolved during reconstruction. */
  connects: [string | null, string | null];
  /** `geometry` = position/width; `swing` = hinge and swing side. */
  sources: Sources<'geometry' | 'height' | 'swing'>;
  confidence?: Confidence;
  note?: string;
}

export type WindowKind = 'standard' | 'large' | 'sliding-door' | 'balcony-door';

export interface Window {
  id: string;
  wallId: string;
  offset: number;
  width: number;
  height: number;
  sillHeight: number;
  kind: WindowKind;
  materialId: string;
  /** Head height = sillHeight + height (derived, never stored). */
  sources: Sources<'geometry' | 'sillHeight' | 'height'>;
  confidence?: Confidence;
}

export interface Stair {
  id: string;
  polygon: Vec2[];
  steps: number;
  rise: number;
  direction: Vec2;
  toLevel: number;
}

export type FixtureKind =
  | 'bath'
  | 'shower'
  | 'toilet'
  | 'basin'
  | 'kitchen-counter'
  | 'sink'
  | 'hob'
  | 'built-in-unit'
  | 'column'
  | 'shaft';

/** A fixed, non-movable object drawn on the plan. Furniture must not collide with it. */
export interface Fixture {
  id: string;
  roomId: string | null;
  kind: FixtureKind;
  label: string;
  footprint: Vec2[];
  height: number;
  /** Elevation of the bottom of the fixture (e.g. a hob sits on a counter). */
  elevation: number;
  materialId: string;
  sources: Sources<'footprint' | 'height'>;
  confidence?: Confidence;
  note?: string;
}

export interface Dimensions3 {
  /** Along the item's local X axis, metres. */
  width: number;
  /** Along the item's local Z axis (front = +Z), metres. */
  depth: number;
  height: number;
}

/**
 * A placed furniture instance. Real-world dimensions are the source of truth; any render
 * scale is derived as dimensions / catalog dimensions.
 */
export interface FurnitureItem {
  id: string;
  catalogId: string;
  name: string;
  category: FurnitureCategory;
  roomId: string;
  /** Centre of the footprint on the floor plane. */
  position: Vec2;
  /** Height of the item's base above the floor. */
  elevation: number;
  /** Rotation about +Y in radians (three.js convention). Local +Z (front) → (sin r, cos r). */
  rotation: number;
  dimensions: Dimensions3;
  materialId: string;
  /** Optional colour override (#rrggbb) applied over the material. */
  color?: string;
  metadata?: Record<string, string | number | boolean>;
}

export type FurnitureCategory =
  | 'sofa'
  | 'armchair'
  | 'bed'
  | 'dining-table'
  | 'dining-chair'
  | 'coffee-table'
  | 'tv-unit'
  | 'wardrobe'
  | 'desk'
  | 'office-chair'
  | 'bookshelf'
  | 'cabinet'
  | 'bedside-table'
  | 'rug'
  | 'lamp'
  | 'plant';

export type LightingPreset = 'warm' | 'neutral' | 'cool' | 'off';

export interface RoomRenovation {
  wallMaterialId: string;
  wallColor?: string;
  floorMaterialId: string;
  floorColor?: string;
  ceilingMaterialId: string;
  ceilingColor?: string;
  trimMaterialId: string;
  doorMaterialId: string;
  windowMaterialId: string;
  lighting: LightingPreset;
}

/** Discriminated reference to any selectable entity. */
export type EntityRef =
  | { kind: 'apartment'; id: string }
  | { kind: 'floor'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'door'; id: string }
  | { kind: 'window'; id: string }
  | { kind: 'fixture'; id: string }
  | { kind: 'furniture'; id: string };

export type EntityKind = EntityRef['kind'];
