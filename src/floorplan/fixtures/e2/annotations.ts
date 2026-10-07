import type { FloorPlanAnnotations } from '../../annotationTypes';

/**
 * REFERENCE FIXTURE — not production logic.
 *
 * Annotation of `floor-plans/E2-floorplan.jpg` (1485 × 1080 px, "Packenham House, Third Floor").
 *
 * Every coordinate below was measured from the image by scanning dark-pixel runs (walls are
 * solid black; door leaves, swing arcs, glazing and fixtures are thin grey lines). Values are
 * pixel EDGES (see annotationTypes.ts). `annotationFidelity.test.ts` decodes the JPEG and
 * re-checks walls and openings against the pixels, so this file cannot silently drift.
 *
 * Nothing here is in metres except quantities the plan does not show (heights), which are
 * explicit, documented assumptions. The scale comes from the printed room dimensions.
 */
export const E2_ANNOTATIONS: FloorPlanAnnotations = {
  formatVersion: 1,
  id: 'packenham-house-e2',
  name: 'Packenham House — Third Floor',
  building: 'Packenham House',
  floorLabel: 'Third Floor',
  level: 3,
  source: { method: 'manual', producer: 'hand-measured from image pixels' },
  image: { file: 'floor-plans/E2-floorplan.jpg', widthPx: 1485, heightPx: 1080 },
  // Outer top-left corner of the building, so all world coordinates are positive.
  originPx: { x: 237, y: 118 },
  reportedArea: {
    m2: 57.4,
    note: 'Printed on plan: "Approx. 57.4 sq. metres (617.8 sq. feet) (excluding Balcony)"',
  },
  internalEnvelope: [
    { x: 255, y: 136 },
    { x: 748, y: 136 },
    { x: 748, y: 254 },
    { x: 1089, y: 254 },
    { x: 1089, y: 817 },
    { x: 757, y: 817 },
    { x: 757, y: 619 },
    { x: 459, y: 619 },
    { x: 459, y: 777 },
    { x: 255, y: 777 },
  ],
  footprint: [
    { x: 237, y: 118 },
    { x: 766, y: 118 },
    { x: 766, y: 236 },
    { x: 1107, y: 236 },
    { x: 1107, y: 835 },
    { x: 739, y: 835 },
    { x: 739, y: 637 },
    { x: 477, y: 637 },
    { x: 477, y: 795 },
    { x: 237, y: 795 },
  ],
  compass: { center: { x: 1176, y: 91 }, northTip: { x: 1231, y: 115 } },
  defaults: {
    ceilingHeightMeters: 2.4,
    doorHeightMeters: 2.0,
    railingHeightMeters: 1.1,
    windowSillMeters: 0.9,
    windowHeadMeters: 2.1,
  },

  walls: [
    // ── External walls (≈18 px ≈ 0.20 m) ────────────────────────────────────────────
    { id: 'w-ext-north', kind: 'exterior', rect: { x0: 237, y0: 118, x1: 766, y1: 136 } },
    { id: 'w-ext-west', kind: 'exterior', rect: { x0: 237, y0: 118, x1: 255, y1: 795 } },
    { id: 'w-ext-south-bath', kind: 'exterior', rect: { x0: 237, y0: 777, x1: 477, y1: 795 } },
    { id: 'w-ext-east-bath', kind: 'exterior', rect: { x0: 459, y0: 619, x1: 477, y1: 795 } },
    {
      id: 'w-ext-south-hall',
      kind: 'exterior',
      rect: { x0: 459, y0: 619, x1: 757, y1: 637 },
      note: 'Entrance wall to the communal corridor (drawn at external-wall thickness).',
    },
    { id: 'w-ext-east-bed2', kind: 'exterior', rect: { x0: 748, y0: 118, x1: 766, y1: 254 } },
    { id: 'w-ext-north-kitchen', kind: 'exterior', rect: { x0: 766, y0: 236, x1: 1107, y1: 254 } },
    { id: 'w-ext-east', kind: 'exterior', rect: { x0: 1089, y0: 236, x1: 1107, y1: 835 } },
    { id: 'w-ext-south-kitchen', kind: 'exterior', rect: { x0: 739, y0: 817, x1: 1107, y1: 835 } },
    { id: 'w-ext-west-kitchen', kind: 'exterior', rect: { x0: 739, y0: 619, x1: 757, y1: 835 } },
    {
      id: 'w-nib-kitchen',
      kind: 'interior',
      rect: { x0: 757, y0: 619, x1: 845, y1: 637 },
      note: 'Full-thickness nib projecting ≈1 m into the open-plan room.',
    },

    // ── Internal partitions (≈9 px ≈ 0.10 m) ───────────────────────────────────────
    { id: 'w-int-bed1-bed2', kind: 'interior', rect: { x0: 490, y0: 136, x1: 499, y1: 475 } },
    { id: 'w-int-hall-north', kind: 'interior', rect: { x0: 255, y0: 475, x1: 748, y1: 484 } },
    { id: 'w-int-bed2-south', kind: 'interior', rect: { x0: 577, y0: 408, x1: 748, y1: 417 } },
    { id: 'w-int-wardrobe-west', kind: 'interior', rect: { x0: 577, y0: 417, x1: 586, y1: 475 } },
    { id: 'w-int-wardrobe-east', kind: 'interior', rect: { x0: 675, y0: 417, x1: 684, y1: 475 } },
    { id: 'w-int-kitchen-hall', kind: 'interior', rect: { x0: 748, y0: 254, x1: 757, y1: 619 } },
    { id: 'w-int-bath-north', kind: 'interior', rect: { x0: 255, y0: 619, x1: 459, y1: 628 } },
    { id: 'w-int-cupboard-top', kind: 'interior', rect: { x0: 401, y0: 561, x1: 558, y1: 570 } },
    { id: 'w-int-cupboard-divider', kind: 'interior', rect: { x0: 459, y0: 570, x1: 468, y1: 619 } },
    { id: 'w-int-cupboard-east', kind: 'interior', rect: { x0: 549, y0: 570, x1: 558, y1: 619 } },
    {
      id: 'w-int-cupboard-front',
      kind: 'interior',
      rect: { x0: 392, y0: 561, x1: 401, y1: 619 },
      note: 'Not drawn solid on the plan: only door jambs and bifold leaves are drawn. Modelled as a frame.',
    },

    // ── Balcony balustrade (thin double line) ───────────────────────────────────────
    { id: 'w-rail-north', kind: 'railing', rect: { x0: 766, y0: 127, x1: 1098, y1: 137 } },
    { id: 'w-rail-east', kind: 'railing', rect: { x0: 1088, y0: 137, x1: 1098, y1: 236 } },
  ],

  doors: [
    {
      id: 'd-front',
      label: 'Entrance door',
      wallId: 'w-ext-south-hall',
      span: [564, 631],
      kind: 'hinged',
      hinge: 'min',
      swing: 'up',
    },
    { id: 'd-bed1', wallId: 'w-int-hall-north', span: [262, 328], kind: 'hinged', hinge: 'min', swing: 'up' },
    { id: 'd-bed2', wallId: 'w-int-hall-north', span: [505, 570], kind: 'hinged', hinge: 'min', swing: 'up' },
    {
      id: 'd-cupboard-c',
      wallId: 'w-int-hall-north',
      span: [690, 741],
      kind: 'hinged',
      hinge: 'max',
      swing: 'down',
    },
    {
      id: 'd-wardrobe',
      wallId: 'w-int-bed2-south',
      span: [592, 668],
      kind: 'double',
      hinge: 'min',
      swing: 'up',
    },
    {
      id: 'd-kitchen',
      label: 'Opening to kitchen/lounge',
      wallId: 'w-int-kitchen-hall',
      span: [486, 554],
      kind: 'opening',
      hinge: 'min',
      swing: 'right',
      note: 'Gap in the partition with no door leaf drawn.',
    },
    {
      id: 'd-bathroom',
      wallId: 'w-int-bath-north',
      span: [323, 390],
      kind: 'hinged',
      hinge: 'max',
      swing: 'up',
    },
    {
      id: 'd-cupboard-b',
      wallId: 'w-int-cupboard-top',
      span: [496, 531],
      kind: 'hinged',
      hinge: 'min',
      swing: 'up',
    },
    {
      id: 'd-cupboard-a',
      wallId: 'w-int-cupboard-front',
      span: [572, 612],
      kind: 'bifold',
      hinge: 'min',
      swing: 'right',
    },
    {
      id: 'd-balcony',
      label: 'Balcony door',
      wallId: 'w-ext-north-kitchen',
      span: [793, 859],
      kind: 'hinged',
      hinge: 'min',
      swing: 'up',
      note: 'The plan draws the wall fill continuously across this door; the opening is taken from the jambs and swing arc.',
    },
  ],

  windows: [
    {
      id: 'win-bed1',
      wallId: 'w-ext-north',
      span: [301, 442],
      kind: 'standard',
    },
    {
      id: 'win-bed2',
      wallId: 'w-ext-north',
      span: [526, 682],
      kind: 'standard',
    },
    {
      id: 'win-kitchen-north',
      wallId: 'w-ext-north-kitchen',
      span: [876, 1080],
      kind: 'large',
    },
    // Over the sink: a sill above worktop height is assumed.
    {
      id: 'win-kitchen-east',
      wallId: 'w-ext-east',
      span: [635, 770],
      kind: 'standard',
      sillHeightMeters: 1.05,
      headHeightMeters: 2.1,
    },
  ],

  rooms: [
    {
      id: 'bedroom-1',
      name: 'Bedroom 1',
      type: 'bedroom',
      labelSource: 'plan-label',
      label: { text: 'Bedroom', dimensionsText: '3.84m x 2.66m (12\'7" x 8\'9")', dimensions: [3.84, 2.66] },
      polygon: [
        { x: 255, y: 136 },
        { x: 490, y: 136 },
        { x: 490, y: 475 },
        { x: 255, y: 475 },
      ],
      dimensions: [
        { meters: 3.84, axis: 'y', span: [136, 475] },
        { meters: 2.66, axis: 'x', span: [255, 490] },
      ],
    },
    {
      id: 'bedroom-2',
      name: 'Bedroom 2',
      type: 'bedroom',
      labelSource: 'plan-label',
      label: { text: 'Bedroom', dimensionsText: '3.08m x 2.61m (10\'1" x 8\'7")', dimensions: [3.08, 2.61] },
      // L-shaped: the door alcove west of the built-in wardrobe belongs to the bedroom.
      polygon: [
        { x: 499, y: 136 },
        { x: 748, y: 136 },
        { x: 748, y: 408 },
        { x: 577, y: 408 },
        { x: 577, y: 475 },
        { x: 499, y: 475 },
      ],
      dimensions: [
        { meters: 3.08, axis: 'y', span: [136, 408] },
        { meters: 2.61, axis: 'x', span: [499, 748] },
      ],
    },
    {
      id: 'wardrobe-bed2',
      name: 'Built-in wardrobe',
      type: 'storage',
      labelSource: 'inferred',
      note: 'Unlabelled enclosed space with double doors opening into Bedroom 2.',
      polygon: [
        { x: 586, y: 417 },
        { x: 675, y: 417 },
        { x: 675, y: 475 },
        { x: 586, y: 475 },
      ],
    },
    {
      id: 'cupboard-hall-north',
      name: 'Hall cupboard',
      type: 'storage',
      labelSource: 'inferred',
      note: 'Unlabelled enclosed space with a door opening into the hall.',
      polygon: [
        { x: 684, y: 417 },
        { x: 748, y: 417 },
        { x: 748, y: 475 },
        { x: 684, y: 475 },
      ],
    },
    {
      id: 'hall',
      name: 'Hall',
      type: 'hall',
      labelSource: 'plan-label',
      label: { text: 'Hall' },
      polygon: [
        { x: 255, y: 484 },
        { x: 748, y: 484 },
        { x: 748, y: 619 },
        { x: 558, y: 619 },
        { x: 558, y: 561 },
        { x: 392, y: 561 },
        { x: 392, y: 619 },
        { x: 255, y: 619 },
      ],
    },
    {
      id: 'cupboard-airing',
      name: 'Cupboard (bifold)',
      type: 'storage',
      labelSource: 'inferred',
      note: 'Unlabelled cupboard with bifold doors; commonly an airing cupboard, but the plan does not say.',
      polygon: [
        { x: 401, y: 570 },
        { x: 459, y: 570 },
        { x: 459, y: 619 },
        { x: 401, y: 619 },
      ],
    },
    {
      id: 'cupboard-hall-south',
      name: 'Hall cupboard (small)',
      type: 'storage',
      labelSource: 'inferred',
      note: 'Unlabelled cupboard with a narrow door opening into the hall.',
      polygon: [
        { x: 468, y: 570 },
        { x: 549, y: 570 },
        { x: 549, y: 619 },
        { x: 468, y: 619 },
      ],
    },
    {
      id: 'bathroom',
      name: 'Bathroom',
      type: 'bathroom',
      labelSource: 'plan-label',
      label: { text: 'Bathroom', dimensionsText: '1.70m x 2.31m (5\'7" x 7\'7")', dimensions: [1.7, 2.31] },
      polygon: [
        { x: 255, y: 628 },
        { x: 459, y: 628 },
        { x: 459, y: 777 },
        { x: 255, y: 777 },
      ],
      dimensions: [
        { meters: 1.7, axis: 'y', span: [628, 777] },
        { meters: 2.31, axis: 'x', span: [255, 459] },
      ],
    },
    {
      id: 'kitchen-living',
      name: 'Kitchen/Lounge/Diner',
      type: 'kitchen-living',
      labelSource: 'plan-label',
      label: {
        text: 'Kitchen/Lounge/Diner',
        dimensionsText: '6.39m x 3.77m (20\'11" x 12\'4")',
        dimensions: [6.39, 3.77],
      },
      // The notch on the west side excludes the wall nib.
      polygon: [
        { x: 757, y: 254 },
        { x: 1089, y: 254 },
        { x: 1089, y: 817 },
        { x: 757, y: 817 },
        { x: 757, y: 637 },
        { x: 845, y: 637 },
        { x: 845, y: 619 },
        { x: 757, y: 619 },
      ],
      dimensions: [
        { meters: 6.39, axis: 'y', span: [254, 817] },
        { meters: 3.77, axis: 'x', span: [757, 1089] },
      ],
    },
    {
      id: 'balcony',
      name: 'Balcony',
      type: 'balcony',
      labelSource: 'plan-label',
      label: { text: 'Balcony' },
      exterior: true,
      polygon: [
        { x: 766, y: 137 },
        { x: 1088, y: 137 },
        { x: 1088, y: 236 },
        { x: 766, y: 236 },
      ],
    },
  ],

  fixtures: [
    {
      id: 'fx-bath',
      kind: 'bath',
      label: 'Bath',
      rect: { x0: 397, y0: 630, x1: 454, y1: 776 },
      heightMeters: 0.55,
      materialId: 'ceramic-white',
    },
    {
      id: 'fx-toilet',
      kind: 'toilet',
      label: 'WC',
      rect: { x0: 267, y0: 720, x1: 315, y1: 777 },
      heightMeters: 0.75,
      materialId: 'ceramic-white',
    },
    {
      id: 'fx-basin',
      kind: 'basin',
      label: 'Basin',
      rect: { x0: 347, y0: 745, x1: 393, y1: 777 },
      heightMeters: 0.85,
      materialId: 'ceramic-white',
    },
    {
      id: 'fx-counter-west',
      kind: 'kitchen-counter',
      label: 'Kitchen unit',
      rect: { x0: 757, y0: 740, x1: 800, y1: 817 },
      heightMeters: 0.9,
      materialId: 'cabinet-white',
    },
    {
      id: 'fx-counter-south',
      kind: 'kitchen-counter',
      label: 'Kitchen counter',
      rect: { x0: 800, y0: 773, x1: 1045, y1: 817 },
      heightMeters: 0.9,
      materialId: 'cabinet-white',
    },
    {
      id: 'fx-counter-east',
      kind: 'kitchen-counter',
      label: 'Kitchen counter (sink run)',
      rect: { x0: 1045, y0: 660, x1: 1089, y1: 817 },
      heightMeters: 0.9,
      materialId: 'cabinet-white',
    },
    {
      id: 'fx-counter-peninsula',
      kind: 'kitchen-counter',
      label: 'Kitchen peninsula',
      rect: { x0: 925, y0: 615, x1: 1089, y1: 660 },
      heightMeters: 0.9,
      materialId: 'cabinet-white',
    },
    {
      id: 'fx-sink',
      kind: 'sink',
      label: 'Sink & drainer',
      rect: { x0: 1045, y0: 647, x1: 1089, y1: 735 },
      heightMeters: 0.02,
      elevationMeters: 0.9,
      materialId: 'steel',
    },
    {
      id: 'fx-hob',
      kind: 'hob',
      label: 'Hob',
      rect: { x0: 942, y0: 775, x1: 987, y1: 817 },
      heightMeters: 0.02,
      elevationMeters: 0.9,
      materialId: 'hob-black',
    },
    {
      id: 'fx-builtin-kitchen',
      kind: 'built-in-unit',
      label: 'Unlabelled built-in',
      rect: { x0: 757, y0: 254, x1: 787, y1: 421 },
      heightMeters: 0.9,
      materialId: 'cabinet-white',
      uncertain: true,
      note: 'Drawn only as a thin outline (≈0.34 × 1.89 m). Its purpose and height are not on the plan.',
    },
  ],

  drawingNotes: [
    {
      id: 'balcony-door-fill',
      message:
        'Wall fill is drawn continuously across the balcony door; the opening is inferred from jambs and the swing arc.',
      rect: { x0: 793, y0: 236, x1: 859, y1: 254 },
    },
    {
      id: 'kitchen-window-fill',
      message:
        'The kitchen window onto the balcony is drawn in the inner half of the wall only; the balcony-side half is filled.',
      rect: { x0: 876, y0: 236, x1: 1080, y1: 245 },
    },
  ],
};
