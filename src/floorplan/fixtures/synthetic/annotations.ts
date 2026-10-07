import type { FloorPlanAnnotations } from '../../annotationTypes';

/**
 * REFERENCE FIXTURE — a small synthetic plan that is deliberately unlike E2:
 *  - an angled (45°) external wall with a window in it,
 *  - an irregular five-sided living room and an L-shaped bedroom,
 *  - a concave (L-shaped) kitchen counter,
 *  - scale from free-standing dimension lines (no room labels with sizes),
 *  - marked as automatic-extractor output with confidences.
 * Scale: 50 px = 1 m. Walls are 10 px (0.2 m) centreline segments.
 */
export const SYNTHETIC_ANNOTATIONS: FloorPlanAnnotations = {
  formatVersion: 1,
  id: 'synthetic-angled',
  name: 'Synthetic angled flat',
  level: 0,
  source: { method: 'automatic', producer: 'synthetic-test-extractor', confidence: 0.8 },
  image: { file: 'synthetic-angled.png', widthPx: 800, heightPx: 600 },
  originPx: { x: 90, y: 90 },
  footprint: [
    { x: 90, y: 90 },
    { x: 510, y: 90 },
    { x: 510, y: 306 },
    { x: 406, y: 410 },
    { x: 310, y: 410 },
    { x: 310, y: 510 },
    { x: 210, y: 510 },
    { x: 210, y: 570 },
    { x: 90, y: 570 },
  ],
  calibration: {
    references: [
      { id: 'dim-top', meters: 8, text: '8.00m', a: { x: 100, y: 80 }, b: { x: 500, y: 80 } },
      { id: 'dim-left', meters: 6, text: '6.00m', a: { x: 80, y: 100 }, b: { x: 80, y: 400 } },
    ],
  },
  defaults: {
    ceilingHeightMeters: 2.5,
    doorHeightMeters: 2.0,
    railingHeightMeters: 1.1,
    windowSillMeters: 0.9,
    windowHeadMeters: 2.1,
  },
  walls: [
    {
      id: 'top',
      kind: 'exterior',
      confidence: 0.95,
      segment: { a: { x: 95, y: 95 }, b: { x: 505, y: 95 }, thicknessPx: 10 },
    },
    {
      id: 'right',
      kind: 'exterior',
      confidence: 0.95,
      segment: { a: { x: 505, y: 95 }, b: { x: 505, y: 303.5 }, thicknessPx: 10 },
    },
    {
      id: 'angled',
      kind: 'exterior',
      confidence: 0.7,
      segment: { a: { x: 503.5, y: 303.5 }, b: { x: 403.5, y: 403.5 }, thicknessPx: 10 },
    },
    {
      id: 'left',
      kind: 'exterior',
      confidence: 0.95,
      segment: { a: { x: 95, y: 95 }, b: { x: 95, y: 565 }, thicknessPx: 10 },
    },
    {
      id: 'middle',
      kind: 'interior',
      confidence: 0.9,
      segment: { a: { x: 95, y: 405 }, b: { x: 405, y: 405 }, thicknessPx: 10 },
    },
    {
      id: 'bed-right',
      kind: 'exterior',
      segment: { a: { x: 305, y: 405 }, b: { x: 305, y: 505 }, thicknessPx: 10 },
    },
    {
      id: 'bed-step',
      kind: 'exterior',
      segment: { a: { x: 195, y: 505 }, b: { x: 305, y: 505 }, thicknessPx: 10 },
    },
    {
      id: 'bed-inner',
      kind: 'exterior',
      segment: { a: { x: 205, y: 505 }, b: { x: 205, y: 565 }, thicknessPx: 10 },
    },
    {
      id: 'bottom',
      kind: 'exterior',
      segment: { a: { x: 95, y: 565 }, b: { x: 205, y: 565 }, thicknessPx: 10 },
    },
  ],
  doors: [
    {
      id: 'door-entry',
      wallId: 'left',
      span: [150, 195],
      kind: 'hinged',
      hinge: 'min',
      swing: 'right',
      confidence: 0.85,
    },
    {
      id: 'door-bed',
      wallId: 'middle',
      span: [130, 175],
      kind: 'hinged',
      hinge: 'min',
      swing: 'down',
      confidence: 0.6,
    },
  ],
  windows: [
    { id: 'win-top', wallId: 'top', span: [200, 350], kind: 'large' },
    { id: 'win-angled', wallId: 'angled', span: [430, 470], kind: 'standard', confidence: 0.5 },
  ],
  labels: [{ id: 'lbl-living', text: 'Living', at: { x: 300, y: 250 }, role: 'room-name', confidence: 0.9 }],
  rooms: [
    {
      id: 'living',
      name: 'Living',
      type: 'living',
      labelSource: 'plan-label',
      labelId: 'lbl-living',
      confidence: 0.9,
      polygon: [
        { x: 100, y: 100 },
        { x: 500, y: 100 },
        { x: 500, y: 300 },
        { x: 400, y: 400 },
        { x: 100, y: 400 },
      ],
    },
    {
      id: 'bedroom',
      name: 'Bedroom',
      type: 'bedroom',
      labelSource: 'plan-label',
      polygon: [
        { x: 100, y: 410 },
        { x: 300, y: 410 },
        { x: 300, y: 500 },
        { x: 200, y: 500 },
        { x: 200, y: 560 },
        { x: 100, y: 560 },
      ],
    },
  ],
  fixtures: [
    {
      id: 'counter-l',
      kind: 'kitchen-counter',
      label: 'L-shaped counter',
      heightMeters: 0.9,
      materialId: 'cabinet-white',
      confidence: 0.75,
      polygon: [
        { x: 400, y: 100 },
        { x: 500, y: 100 },
        { x: 500, y: 250 },
        { x: 470, y: 250 },
        { x: 470, y: 130 },
        { x: 400, y: 130 },
      ],
    },
  ],
  drawingNotes: [],
};
