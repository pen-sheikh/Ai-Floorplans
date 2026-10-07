import type { FloorPlanAnnotations, PxPoint } from '../../annotationTypes';
import type { PlanStyle } from '../render/planSvg';

/**
 * REFERENCE FIXTURE — synthetic flat drawn unlike E2: 60 px = 1 m, grey outlined walls
 * (0.25 m external, 0.1 m internal), door frames drawn as jamb boxes, an L-shaped living room,
 * a symbol-less kitchen doorway, and room sizes printed in millimetres ("3325 x 2825").
 * The image (floor-plans/test/synthetic-mm.png) is rendered from these annotations.
 */
const PPM = 60;
const O = { x: 100, y: 100 };
const P = (x: number, y: number): PxPoint => ({ x: O.x + x * PPM, y: O.y + y * PPM });
const X = (x: number) => O.x + x * PPM;
const Y = (y: number) => O.y + y * PPM;
const EXT = 0.25 * PPM;
const INT = 0.1 * PPM;
const wall = (id: string, kind: 'exterior' | 'interior', a: PxPoint, b: PxPoint) => ({
  id,
  kind,
  segment: { a, b, thicknessPx: kind === 'exterior' ? EXT : INT },
});
const rect = (x0: number, y0: number, x1: number, y1: number) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
const dims = (id: string, x0: number, y0: number, x1: number, y1: number, text: string) => ({
  text,
  dims: [
    {
      id: `${id}#x`,
      meters: +(x1 - x0).toFixed(3),
      axis: 'x' as const,
      span: [X(x0), X(x1)] as [number, number],
      text,
    },
    {
      id: `${id}#y`,
      meters: +(y1 - y0).toFixed(3),
      axis: 'y' as const,
      span: [Y(y0), Y(y1)] as [number, number],
      text,
    },
  ],
});

const living = dims('living', 0.125, 0.125, 5.95, 7.375, '5825 x 7250');
const kitchen = dims('kitchen', 0.125, 4.55, 3.45, 7.375, '3325 x 2825');
const bedroom = dims('bedroom', 6.05, 0.125, 9.875, 3.95, '3825 x 3825');
const entrance = dims('entrance', 6.05, 4.05, 7.95, 7.375, '1900 x 3325');
const ensuite = dims('ensuite', 8.05, 4.05, 9.875, 7.375, '1825 x 3325');

export const SYNTHETIC_MM_ANNOTATIONS: FloorPlanAnnotations = {
  formatVersion: 1,
  id: 'synthetic-mm',
  name: 'Synthetic flat (mm dimensions)',
  floorLabel: 'Ground Floor',
  level: 0,
  source: { method: 'manual', producer: 'synthetic ground truth' },
  image: { file: 'synthetic-mm.png', widthPx: 800, heightPx: 640 },
  originPx: P(-0.125, -0.125),
  reportedArea: { m2: 68.6, note: 'Printed on the plan' },
  footprint: rect(-0.125, -0.125, 10.125, 7.625),
  internalEnvelope: rect(0.125, 0.125, 9.875, 7.375),
  calibration: {},
  defaults: {
    ceilingHeightMeters: 2.5,
    doorHeightMeters: 2.0,
    railingHeightMeters: 1.1,
    windowSillMeters: 0.9,
    windowHeadMeters: 2.1,
  },
  walls: [
    wall('ext-top', 'exterior', P(0, 0), P(10, 0)),
    wall('ext-right', 'exterior', P(10, 0), P(10, 7.5)),
    wall('ext-bottom', 'exterior', P(0, 7.5), P(10, 7.5)),
    wall('ext-left', 'exterior', P(0, 0), P(0, 7.5)),
    wall('int-living-east', 'interior', P(6, 0), P(6, 7.5)),
    wall('int-bedroom-south', 'interior', P(6, 4), P(10, 4)),
    wall('int-ensuite-west', 'interior', P(8, 4), P(8, 7.5)),
    wall('int-kitchen-north', 'interior', P(0, 4.5), P(3.5, 4.5)),
    wall('int-kitchen-east', 'interior', P(3.5, 4.5), P(3.5, 7.5)),
  ],
  doors: [
    {
      id: 'd-front',
      wallId: 'ext-bottom',
      span: [X(6.4), X(7.4)],
      kind: 'hinged',
      hinge: 'min',
      swing: 'up',
    },
    {
      id: 'd-living',
      wallId: 'int-living-east',
      span: [Y(5.0), Y(5.85)],
      kind: 'hinged',
      hinge: 'max',
      swing: 'left',
    },
    {
      id: 'd-bedroom',
      wallId: 'int-bedroom-south',
      span: [X(6.3), X(7.15)],
      kind: 'hinged',
      hinge: 'min',
      swing: 'up',
    },
    {
      id: 'd-ensuite',
      wallId: 'int-ensuite-west',
      span: [Y(5.2), Y(5.95)],
      kind: 'hinged',
      hinge: 'min',
      swing: 'right',
    },
    {
      id: 'd-kitchen',
      wallId: 'int-kitchen-east',
      span: [Y(5.2), Y(6.4)],
      kind: 'opening',
      hinge: 'min',
      swing: 'left',
    },
  ],
  windows: [
    { id: 'win-living', wallId: 'ext-top', span: [X(1), X(3)], kind: 'large' },
    { id: 'win-bedroom', wallId: 'ext-top', span: [X(7), X(9)], kind: 'large' },
    { id: 'win-kitchen', wallId: 'ext-left', span: [Y(5.5), Y(6.8)], kind: 'standard' },
    { id: 'win-ensuite', wallId: 'ext-right', span: [Y(5.3), Y(6.1)], kind: 'standard' },
  ],
  labels: [
    { id: 'lbl-living', text: 'LIVING / DINING', at: P(2.6, 2.0), role: 'room-name' },
    { id: 'lbl-kitchen', text: 'KITCHEN', at: P(1.8, 5.6), role: 'room-name' },
    { id: 'lbl-bedroom', text: 'BEDROOM', at: P(8.0, 1.9), role: 'room-name' },
    { id: 'lbl-entrance', text: 'ENTRANCE', at: P(7.0, 5.3), role: 'room-name' },
    { id: 'lbl-ensuite', text: 'ENSUITE', at: P(8.95, 6.6), role: 'room-name' },
  ],
  rooms: [
    {
      id: 'living',
      name: 'Living / Dining',
      type: 'living',
      labelSource: 'plan-label',
      labelId: 'lbl-living',
      label: { text: 'LIVING / DINING', dimensionsText: living.text, dimensions: [5.825, 7.25] },
      dimensions: living.dims,
      polygon: [
        P(0.125, 0.125),
        P(5.95, 0.125),
        P(5.95, 7.375),
        P(3.55, 7.375),
        P(3.55, 4.45),
        P(0.125, 4.45),
      ],
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      type: 'kitchen',
      labelSource: 'plan-label',
      labelId: 'lbl-kitchen',
      label: { text: 'KITCHEN', dimensionsText: kitchen.text, dimensions: [3.325, 2.825] },
      dimensions: kitchen.dims,
      polygon: rect(0.125, 4.55, 3.45, 7.375),
    },
    {
      id: 'bedroom',
      name: 'Bedroom',
      type: 'bedroom',
      labelSource: 'plan-label',
      labelId: 'lbl-bedroom',
      label: { text: 'BEDROOM', dimensionsText: bedroom.text, dimensions: [3.825, 3.825] },
      dimensions: bedroom.dims,
      polygon: rect(6.05, 0.125, 9.875, 3.95),
    },
    {
      id: 'entrance',
      name: 'Entrance',
      type: 'hall',
      labelSource: 'plan-label',
      labelId: 'lbl-entrance',
      label: { text: 'ENTRANCE', dimensionsText: entrance.text, dimensions: [1.9, 3.325] },
      dimensions: entrance.dims,
      polygon: rect(6.05, 4.05, 7.95, 7.375),
    },
    {
      id: 'ensuite',
      name: 'Ensuite',
      type: 'bathroom',
      labelSource: 'plan-label',
      labelId: 'lbl-ensuite',
      label: { text: 'ENSUITE', dimensionsText: ensuite.text, dimensions: [1.825, 3.325] },
      dimensions: ensuite.dims,
      polygon: rect(8.05, 4.05, 9.875, 7.375),
    },
  ],
  fixtures: [
    {
      id: 'kitchen-counter',
      kind: 'kitchen-counter',
      label: 'Counter',
      heightMeters: 0.9,
      materialId: 'cabinet-white',
      polygon: rect(0.7, 6.775, 3.45, 7.375),
    },
  ],
  drawingNotes: [],
};

export const SYNTHETIC_MM_STYLE: PlanStyle = {
  wallFill: '#4a4a4a',
  wallStroke: '#000',
  lineColor: '#555',
  lineWidth: 1.3,
  doorJambPx: 5,
  fontFamily: 'Arial, Helvetica, sans-serif',
  nameFontPx: 15,
  dimFontPx: 13,
  upperCaseNames: true,
  drawFixtures: true,
  notes: [
    { text: 'GROUND FLOOR', at: { x: 400, y: 40 }, fontPx: 18 },
    { text: 'Approx. 68.6 sq m', at: { x: 400, y: 600 }, fontPx: 14 },
  ],
};
