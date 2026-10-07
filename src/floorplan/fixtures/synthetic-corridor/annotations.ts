import type { FloorPlanAnnotations, PxPoint } from '../../annotationTypes';
import type { PlanStyle } from '../render/planSvg';

/**
 * REFERENCE FIXTURE — synthetic single-storey house unlike E2: a small scale (40 px = 1 m),
 * a central corridor with rooms on both sides (many T-junctions), a double door, a WC and a
 * store, serif title-case labels with NO room sizes, and the scale given only by overall
 * dimension lines (one horizontal, one vertical with rotated text). Two rooms share a name,
 * and a balcony off the kitchen is enclosed only by a railing drawn as a hollow double line.
 * The image (floor-plans/test/synthetic-corridor.png) is rendered from these annotations.
 */
const PPM = 40;
const O = { x: 90, y: 90 };
const P = (x: number, y: number): PxPoint => ({ x: O.x + x * PPM, y: O.y + y * PPM });
const X = (x: number) => O.x + x * PPM;
const EXT = 0.3 * PPM;
const INT = 0.15 * PPM;
const RAIL = 0.15 * PPM;
const wall = (id: string, kind: 'exterior' | 'interior', a: PxPoint, b: PxPoint) => ({
  id,
  kind,
  segment: { a, b, thicknessPx: kind === 'exterior' ? EXT : INT },
});
const rect = (x0: number, y0: number, x1: number, y1: number) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
const Yp = (y: number) => O.y + y * PPM;

export const SYNTHETIC_CORRIDOR_ANNOTATIONS: FloorPlanAnnotations = {
  formatVersion: 1,
  id: 'synthetic-corridor',
  name: 'Synthetic corridor house',
  floorLabel: 'First Floor',
  level: 0,
  source: { method: 'manual', producer: 'synthetic ground truth' },
  image: { file: 'synthetic-corridor.png', widthPx: 720, heightPx: 500 },
  originPx: P(-0.15, -0.15),
  footprint: rect(-0.15, -0.15, 11.85, 8.25),
  internalEnvelope: rect(0.15, 0.15, 11.55, 7.95),
  calibration: {
    references: [
      { id: 'dim-width', meters: 12, text: '12.00 m', a: P(-0.15, -0.9), b: P(11.85, -0.9) },
      { id: 'dim-depth', meters: 8.4, text: '8.40 m', a: P(-0.9, -0.15), b: P(-0.9, 8.25) },
    ],
  },
  defaults: {
    ceilingHeightMeters: 2.4,
    doorHeightMeters: 2.0,
    railingHeightMeters: 1.1,
    windowSillMeters: 0.9,
    windowHeadMeters: 2.1,
  },
  walls: [
    wall('ext-top', 'exterior', P(0, 0), P(11.7, 0)),
    wall('ext-right', 'exterior', P(11.7, 0), P(11.7, 8.1)),
    wall('ext-bottom', 'exterior', P(0, 8.1), P(11.7, 8.1)),
    wall('ext-left', 'exterior', P(0, 0), P(0, 8.1)),
    wall('int-hall-north', 'interior', P(0, 3.6), P(11.7, 3.6)),
    wall('int-hall-south', 'interior', P(0, 4.8), P(11.7, 4.8)),
    wall('int-lounge-east', 'interior', P(5, 0), P(5, 3.6)),
    wall('int-bed-west-east', 'interior', P(3.6, 4.8), P(3.6, 8.1)),
    wall('int-bath-east', 'interior', P(5.6, 4.8), P(5.6, 8.1)),
    wall('int-wc-east', 'interior', P(7, 4.8), P(7, 8.1)),
    wall('int-store-east', 'interior', P(8, 4.8), P(8, 8.1)),
    // Balcony railing: from the outer face of the east wall, around and back.
    { id: 'rail-north', kind: 'railing', segment: { a: P(11.85, 0.6), b: P(13.85, 0.6), thicknessPx: RAIL } },
    { id: 'rail-east', kind: 'railing', segment: { a: P(13.85, 0.6), b: P(13.85, 3.2), thicknessPx: RAIL } },
    { id: 'rail-south', kind: 'railing', segment: { a: P(11.85, 3.2), b: P(13.85, 3.2), thicknessPx: RAIL } },
  ],
  doors: [
    {
      id: 'd-front',
      wallId: 'ext-left',
      span: [Yp(3.75), Yp(4.65)],
      kind: 'hinged',
      hinge: 'min',
      swing: 'right',
    },
    {
      id: 'd-lounge',
      wallId: 'int-hall-north',
      span: [X(2.0), X(2.9)],
      kind: 'hinged',
      hinge: 'min',
      swing: 'up',
    },
    {
      id: 'd-kitchen',
      wallId: 'int-hall-north',
      span: [X(7.0), X(8.6)],
      kind: 'double',
      hinge: 'min',
      swing: 'up',
    },
    {
      id: 'd-bed-west',
      wallId: 'int-hall-south',
      span: [X(1.0), X(1.85)],
      kind: 'hinged',
      hinge: 'max',
      swing: 'down',
    },
    {
      id: 'd-bath',
      wallId: 'int-hall-south',
      span: [X(4.2), X(4.95)],
      kind: 'hinged',
      hinge: 'min',
      swing: 'down',
    },
    {
      id: 'd-wc',
      wallId: 'int-hall-south',
      span: [X(5.9), X(6.6)],
      kind: 'hinged',
      hinge: 'min',
      swing: 'down',
    },
    {
      id: 'd-store',
      wallId: 'int-hall-south',
      span: [X(7.15), X(7.85)],
      kind: 'hinged',
      hinge: 'min',
      swing: 'down',
    },
    {
      id: 'd-bed-east',
      wallId: 'int-hall-south',
      span: [X(9.0), X(9.85)],
      kind: 'hinged',
      hinge: 'max',
      swing: 'down',
    },
    {
      id: 'd-balcony',
      wallId: 'ext-right',
      span: [Yp(1.0), Yp(1.85)],
      kind: 'hinged',
      hinge: 'min',
      swing: 'left',
    },
  ],
  windows: [
    { id: 'win-lounge', wallId: 'ext-top', span: [X(1.2), X(3.6)], kind: 'large' },
    { id: 'win-kitchen-north', wallId: 'ext-top', span: [X(7.0), X(10.0)], kind: 'large' },
    { id: 'win-kitchen-east', wallId: 'ext-right', span: [Yp(2.2), Yp(3.0)], kind: 'standard' },
    { id: 'win-bed-west', wallId: 'ext-bottom', span: [X(0.9), X(2.7)], kind: 'large' },
    { id: 'win-bath', wallId: 'ext-bottom', span: [X(4.1), X(5.1)], kind: 'standard' },
    { id: 'win-bed-east', wallId: 'ext-bottom', span: [X(9.0), X(10.8)], kind: 'large' },
  ],
  labels: [
    { id: 'lbl-lounge', text: 'Lounge', at: P(2.5, 1.6), role: 'room-name' },
    { id: 'lbl-kitchen', text: 'Kitchen / Diner', at: P(8.3, 1.6), role: 'room-name' },
    { id: 'lbl-hall', text: 'Hall', at: P(3.2, 4.2), role: 'room-name' },
    { id: 'lbl-bed-west', text: 'Bedroom', at: P(1.85, 6.5), role: 'room-name' },
    { id: 'lbl-bath', text: 'Bath', at: P(4.6, 6.5), role: 'room-name' },
    { id: 'lbl-wc', text: 'WC', at: P(6.3, 6.5), role: 'room-name' },
    { id: 'lbl-bed-east', text: 'Bedroom', at: P(9.8, 6.5), role: 'room-name' },
    { id: 'lbl-balcony', text: 'Balcony', at: P(12.85, 1.9), role: 'room-name' },
  ],
  rooms: [
    {
      id: 'lounge',
      name: 'Lounge',
      type: 'living',
      labelSource: 'plan-label',
      labelId: 'lbl-lounge',
      label: { text: 'Lounge' },
      polygon: rect(0.15, 0.15, 4.925, 3.525),
    },
    {
      id: 'kitchen',
      name: 'Kitchen / Diner',
      type: 'kitchen-living',
      labelSource: 'plan-label',
      labelId: 'lbl-kitchen',
      label: { text: 'Kitchen / Diner' },
      polygon: rect(5.075, 0.15, 11.55, 3.525),
    },
    {
      id: 'hall',
      name: 'Hall',
      type: 'hall',
      labelSource: 'plan-label',
      labelId: 'lbl-hall',
      label: { text: 'Hall' },
      polygon: rect(0.15, 3.675, 11.55, 4.725),
    },
    {
      id: 'bed-west',
      name: 'Bedroom 2',
      type: 'bedroom',
      labelSource: 'plan-label',
      labelId: 'lbl-bed-west',
      label: { text: 'Bedroom' },
      polygon: rect(0.15, 4.875, 3.525, 7.95),
    },
    {
      id: 'bath',
      name: 'Bath',
      type: 'bathroom',
      labelSource: 'plan-label',
      labelId: 'lbl-bath',
      label: { text: 'Bath' },
      polygon: rect(3.675, 4.875, 5.525, 7.95),
    },
    {
      id: 'wc',
      name: 'WC',
      type: 'toilet',
      labelSource: 'plan-label',
      labelId: 'lbl-wc',
      label: { text: 'WC' },
      polygon: rect(5.675, 4.875, 6.925, 7.95),
    },
    // Unlabelled on the drawing: a reader infers a store from its size.
    {
      id: 'store',
      name: 'Store',
      type: 'storage',
      labelSource: 'inferred',
      polygon: rect(7.075, 4.875, 7.925, 7.95),
    },
    {
      id: 'balcony',
      name: 'Balcony',
      type: 'balcony',
      labelSource: 'plan-label',
      labelId: 'lbl-balcony',
      label: { text: 'Balcony' },
      exterior: true,
      polygon: rect(11.85, 0.675, 13.775, 3.125),
    },
    {
      id: 'bed-east',
      name: 'Bedroom 1',
      type: 'bedroom',
      labelSource: 'plan-label',
      labelId: 'lbl-bed-east',
      label: { text: 'Bedroom' },
      polygon: rect(8.075, 4.875, 11.55, 7.95),
    },
  ],
  fixtures: [],
  drawingNotes: [],
};

export const SYNTHETIC_CORRIDOR_STYLE: PlanStyle = {
  wallFill: '#000',
  lineColor: '#333',
  lineWidth: 1.2,
  fontFamily: "Georgia, 'Times New Roman', serif",
  nameFontPx: 15,
  dimFontPx: 14,
  upperCaseNames: false,
  notes: [{ text: 'First Floor', at: { x: 620, y: 470 }, fontPx: 15 }],
};
