import type { DoorKind, FixtureKind, RoomType, WallKind, WindowKind } from '../domain/types';

/**
 * A floor-plan annotation describes what is drawn on a plan image, in that image's pixel
 * coordinates. It is the hand-off point between "plan interpretation" (manual today,
 * automated extraction later) and the deterministic reconstruction in `reconstruct.ts`.
 *
 * Pixel convention: coordinates are pixel EDGES. A wall whose dark pixels occupy columns
 * 237…254 inclusive spans x0 = 237, x1 = 255. Thickness in px = x1 − x0.
 */

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

export interface AnnotatedWall {
  id: string;
  /** Solid wall rectangle as drawn. The long side gives the centreline, the short side the thickness. */
  rect: PxRect;
  kind: WallKind;
  note?: string;
}

/** An opening along a wall's long axis, in absolute image pixels along that axis. */
export interface AnnotatedSpan {
  wallId: string;
  /** [from, to) along the wall's long axis, image pixels. */
  span: [number, number];
}

export interface AnnotatedDoor extends AnnotatedSpan {
  id: string;
  kind: DoorKind;
  /** Which end of the span holds the hinge: the lower or higher image coordinate. */
  hinge: 'min' | 'max';
  /** Direction the leaf swings into (as drawn by the swing arc). */
  swing: PxDirection;
  label?: string;
  note?: string;
  heightMeters?: number;
}

export interface AnnotatedWindow extends AnnotatedSpan {
  id: string;
  kind: WindowKind;
  /** Not on the plan — recorded as an assumption. */
  sillHeightMeters: number;
  headHeightMeters: number;
}

/** Printed dimension label tied to the drawn span it describes. */
export interface AnnotatedDimension {
  meters: number;
  axis: 'x' | 'y';
  /** [from, to) image pixels the printed length refers to (interior wall faces). */
  span: [number, number];
}

export interface AnnotatedRoom {
  id: string;
  /** Name as printed, or a descriptive name when inferred. */
  name: string;
  type: RoomType;
  labelSource: 'plan-label' | 'inferred' | 'unknown';
  label?: { text: string; dimensionsText?: string; dimensions?: [number, number] };
  /** Interior footprint, pixel edges. */
  polygon: PxPoint[];
  dimensions?: AnnotatedDimension[];
  exterior?: boolean;
  note?: string;
}

export interface AnnotatedFixture {
  id: string;
  kind: FixtureKind;
  label: string;
  rect: PxRect;
  heightMeters: number;
  elevationMeters?: number;
  materialId: string;
  /** True when the plan only shows an outline and the object's nature/height is a guess. */
  uncertain?: boolean;
  note?: string;
}

export interface FloorPlanAnnotation {
  id: string;
  name: string;
  building?: string;
  floorLabel?: string;
  level: number;
  image: { file: string; widthPx: number; heightPx: number };
  /** Pixel that becomes world (0, 0). */
  originPx: PxPoint;
  /** Area printed on the plan, for cross-checking. */
  reportedArea?: { m2: number; note: string };
  /** Interior envelope (inner face of the external walls) for the area cross-check. */
  internalEnvelope: PxPoint[];
  /** Outer face of the external walls (slab outline). */
  footprint: PxPoint[];
  /** Compass: centre of the rose and the tip of the north needle. */
  compass?: { center: PxPoint; northTip: PxPoint };
  /** Defaults not present on the plan. */
  defaults: {
    ceilingHeightMeters: number;
    doorHeightMeters: number;
    railingHeightMeters: number;
  };
  walls: AnnotatedWall[];
  doors: AnnotatedDoor[];
  windows: AnnotatedWindow[];
  rooms: AnnotatedRoom[];
  fixtures: AnnotatedFixture[];
  /** Drawing artefacts the reconstruction should know about (e.g. wall fill drawn across a door). */
  drawingNotes: { id: string; message: string; rect?: PxRect }[];
}
