import type { DoorKind, FixtureKind, RoomType, WallKind, WindowKind } from '../domain/types';

/**
 * FloorPlanAnnotations: the hand-off format between plan *interpretation* (a person today,
 * an automatic extractor later) and the deterministic reconstruction in `reconstruct.ts`.
 * Reconstruction never needs to know which of the two produced it.
 *
 * Everything is in the source image's pixel coordinates. Convention: coordinates are pixel
 * EDGES — a wall whose dark pixels occupy columns 237…254 inclusive spans x0 = 237, x1 = 255.
 * Only values the plan cannot express (heights) are in metres, and are flagged as assumptions.
 */
export const ANNOTATION_FORMAT_VERSION = 1 as const;

export interface PxPoint {
  x: number;
  y: number;
}

/** Axis-aligned rectangle in pixel edges: [x0, x1) × [y0, y1). */
export interface PxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Image-space directions. 'up' = −y (towards the top of the image). */
export type PxDirection = 'up' | 'down' | 'left' | 'right';

/** Confidence in [0, 1]. Omit for manually verified data. */
export type AnnotationConfidence = number;

interface Element {
  id: string;
  confidence?: AnnotationConfidence;
  note?: string;
}

/**
 * A wall, either as the solid rectangle drawn on an orthogonal plan (`rect`), or as a
 * centreline segment with thickness (`segment`) for walls at any angle.
 */
export type AnnotatedWall = Element & { kind: WallKind } & (
    { rect: PxRect } | { segment: { a: PxPoint; b: PxPoint; thicknessPx: number } }
  );

/**
 * An opening along a wall. `span` is [from, to) in absolute image pixels measured on the
 * wall's DOMINANT axis (x if the wall is closer to horizontal, otherwise y). For the
 * horizontal/vertical walls of most plans these are simply the x or y coordinates read off
 * the image; for angled walls they are projected onto the wall.
 */
export interface AnnotatedSpan {
  wallId: string;
  span: [number, number];
}

export interface AnnotatedDoor extends Element, AnnotatedSpan {
  kind: DoorKind;
  /** Which end of the span holds the hinge: the lower or higher dominant-axis coordinate. */
  hinge: 'min' | 'max';
  /** Direction the leaf swings into (as drawn by the swing arc). Ignored for 'opening'. */
  swing: PxDirection;
  label?: string;
  /** Overrides the plan default. Heights are 'assumed' unless `heightFromPlan` is set. */
  heightMeters?: number;
  heightFromPlan?: boolean;
}

export interface AnnotatedWindow extends Element, AnnotatedSpan {
  kind: WindowKind;
  /** Default: `defaults.windowSillMeters`. */
  sillHeightMeters?: number;
  /** Default: `defaults.windowHeadMeters`. */
  headHeightMeters?: number;
  /** True only when the plan (e.g. an elevation) states the heights. */
  heightsFromPlan?: boolean;
}

/**
 * A printed length tied to the drawn distance it describes. Used for scale calibration.
 * Either an axis-aligned `span` or two end points `a`/`b` (any direction).
 */
export type AnnotatedDimension = {
  id?: string;
  meters: number;
  /** printed (default): a dimension on the plan; reference: a measurement the user supplied. */
  kind?: 'printed' | 'reference';
  /** Text as printed, e.g. "3.84m". */
  text?: string;
  confidence?: AnnotationConfidence;
} & ({ axis: 'x' | 'y'; span: [number, number] } | { a: PxPoint; b: PxPoint });

/** Text found on the plan (room names, dimension strings, notes). */
export interface AnnotatedLabel extends Element {
  text: string;
  at: PxPoint;
  role: 'room-name' | 'dimension' | 'title' | 'other';
}

export interface AnnotatedRoom extends Element {
  /** Name as printed, or a descriptive name when inferred. */
  name: string;
  type: RoomType;
  labelSource: 'plan-label' | 'inferred' | 'unknown';
  label?: { text: string; dimensionsText?: string; dimensions?: [number, number] };
  /** Optional link to the label element the name was read from. */
  labelId?: string;
  /** Interior footprint, pixel edges. Any simple polygon (concave allowed). */
  polygon: PxPoint[];
  /** Printed room dimensions, with the drawn spans they refer to. */
  dimensions?: AnnotatedDimension[];
  exterior?: boolean;
}

export type AnnotatedFixture = Element & {
  kind: FixtureKind;
  label: string;
  heightMeters: number;
  elevationMeters?: number;
  materialId: string;
  /** True when the plan only shows an outline and the object's nature/height is a guess. */
  uncertain?: boolean;
} & ({ rect: PxRect } | { polygon: PxPoint[] });

export interface FloorPlanAnnotations {
  formatVersion: typeof ANNOTATION_FORMAT_VERSION;
  id: string;
  name: string;
  building?: string;
  floorLabel?: string;
  level: number;
  /** Who/what produced these annotations. Reconstruction records it; it does not branch on it. */
  source: { method: 'manual' | 'automatic'; producer?: string; confidence?: AnnotationConfidence };
  image: { file: string; widthPx: number; heightPx: number };
  /** Pixel that becomes world (0, 0). */
  originPx: PxPoint;
  /** Area printed on the plan, for cross-checking. */
  reportedArea?: { m2: number; note: string };
  /** Interior envelope (inner face of the external walls) for the area cross-check. */
  internalEnvelope?: PxPoint[];
  /** Outer face of the external walls (slab outline). */
  footprint: PxPoint[];
  /** Compass: centre of the rose and the tip of the north needle. */
  compass?: { center: PxPoint; northTip: PxPoint };
  /**
   * Scale sources besides room dimension labels: free-standing dimension lines, or a
   * manually entered scale when the plan has no usable dimensions.
   */
  calibration?: {
    references?: AnnotatedDimension[];
    manualPixelsPerMeter?: number;
    /** Last resort when nothing better exists; recorded as an estimate, never as measured. */
    estimatedPixelsPerMeter?: { value: number; basis: string };
  };
  /** Values the plan does not show. All are recorded as assumptions. */
  defaults: {
    ceilingHeightMeters: number;
    doorHeightMeters: number;
    railingHeightMeters: number;
    windowSillMeters: number;
    windowHeadMeters: number;
  };
  walls: AnnotatedWall[];
  doors: AnnotatedDoor[];
  windows: AnnotatedWindow[];
  rooms: AnnotatedRoom[];
  fixtures: AnnotatedFixture[];
  labels?: AnnotatedLabel[];
  /** Drawing artefacts the reconstruction should know about (e.g. wall fill drawn across a door). */
  drawingNotes: { id: string; message: string; rect?: PxRect }[];
}

/** @deprecated Use FloorPlanAnnotations. Kept so older imports keep compiling. */
export type FloorPlanAnnotation = FloorPlanAnnotations;

/** Measured pixel length of a dimension reference. */
export function dimensionPx(d: AnnotatedDimension): number {
  return 'span' in d ? Math.abs(d.span[1] - d.span[0]) : Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
}
