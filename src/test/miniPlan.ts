import type {
  AnnotatedDoor,
  AnnotatedWall,
  AnnotatedWindow,
  FloorPlanAnnotations,
  PxPoint,
} from '../floorplan/annotationTypes';
import { preprocessImage, wallThicknessProfile } from '../floorplan/cv/preprocess';
import { detectOpenings } from '../floorplan/cv/openings';
import { detectWalls } from '../floorplan/cv/walls';
import type { PlanStyle } from '../floorplan/fixtures/render/planSvg';
import { rasterPlan } from './rasterPlan';

/** Small hand-written plans for unit tests of the image-processing stages. */
export function wall(
  id: string,
  a: PxPoint,
  b: PxPoint,
  thicknessPx: number,
  kind: AnnotatedWall['kind'] = 'exterior',
): AnnotatedWall {
  return { id, kind, segment: { a, b, thicknessPx } };
}

export function miniPlan(
  width: number,
  height: number,
  walls: AnnotatedWall[],
  doors: AnnotatedDoor[] = [],
  windows: AnnotatedWindow[] = [],
): FloorPlanAnnotations {
  return {
    formatVersion: 1,
    id: 'mini',
    name: 'mini',
    level: 0,
    source: { method: 'manual' },
    image: { file: 'mini.png', widthPx: width, heightPx: height },
    originPx: { x: 0, y: 0 },
    footprint: [],
    defaults: {
      ceilingHeightMeters: 2.4,
      doorHeightMeters: 2,
      railingHeightMeters: 1.1,
      windowSillMeters: 0.9,
      windowHeadMeters: 2.1,
    },
    walls,
    doors,
    windows,
    rooms: [],
    fixtures: [],
    drawingNotes: [],
  };
}

/** A closed rectangular box of four walls (centrelines), thickness t. */
export function box(x0: number, y0: number, x1: number, y1: number, t: number): AnnotatedWall[] {
  return [
    wall('top', { x: x0, y: y0 }, { x: x1, y: y0 }, t),
    wall('right', { x: x1, y: y0 }, { x: x1, y: y1 }, t),
    wall('bottom', { x: x0, y: y1 }, { x: x1, y: y1 }, t),
    wall('left', { x: x0, y: y0 }, { x: x0, y: y1 }, t),
  ];
}

/** Rasterise a mini plan and run preprocessing, wall and opening detection. */
export function detectOnPlan(ann: FloorPlanAnnotations, style?: PlanStyle) {
  const img = rasterPlan(ann, style);
  const pre = preprocessImage(img);
  const profile = wallThicknessProfile(pre);
  const walls = detectWalls(pre, profile);
  const ctx = {
    gray: pre.gray,
    wallMask: walls.wallMask,
    profile,
    lineThreshold: Math.max(pre.inkThreshold + 60, 215),
  };
  const openings = detectOpenings(ctx, walls.walls);
  return { img, pre, profile, walls, openings, ctx };
}
