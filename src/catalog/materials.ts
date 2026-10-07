/**
 * Reusable material library. Everything in the scene references materials by id; the
 * renderer turns a MaterialDef into a cached three.js material (see scene/materialCache.ts).
 */

export type MaterialCategory =
  | 'wall'
  | 'floor'
  | 'ceiling'
  | 'wood'
  | 'fabric'
  | 'metal'
  | 'glass'
  | 'stone'
  | 'cabinet'
  | 'countertop'
  | 'ceramic'
  | 'plant';

/** Procedural surface patterns, generated once per material and cached. */
export type MaterialPattern = 'none' | 'planks' | 'tiles' | 'marble' | 'carpet' | 'concrete' | 'herringbone';

export interface MaterialDef {
  id: string;
  name: string;
  /** Where the material may be offered in the UI. */
  uses: MaterialUse[];
  category: MaterialCategory;
  color: string;
  roughness: number;
  metalness: number;
  pattern: MaterialPattern;
  /** Size in metres of one pattern repeat (plank length, tile size, …). */
  patternSize?: number;
  opacity?: number;
}

export type MaterialUse = 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'trim' | 'furniture' | 'fixture';

const m = (def: MaterialDef): MaterialDef => def;

export const MATERIALS: readonly MaterialDef[] = [
  // Walls
  m({
    id: 'paint-white',
    name: 'White paint',
    uses: ['wall', 'ceiling', 'trim', 'door'],
    category: 'wall',
    color: '#f4f3ef',
    roughness: 0.92,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'paint-cream',
    name: 'Cream paint',
    uses: ['wall', 'ceiling'],
    category: 'wall',
    color: '#efe6d2',
    roughness: 0.92,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'paint-beige',
    name: 'Light beige paint',
    uses: ['wall'],
    category: 'wall',
    color: '#e3d5bf',
    roughness: 0.92,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'paint-gray',
    name: 'Soft grey paint',
    uses: ['wall'],
    category: 'wall',
    color: '#c9cbcc',
    roughness: 0.92,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'paint-sage',
    name: 'Sage accent',
    uses: ['wall'],
    category: 'wall',
    color: '#a8b59a',
    roughness: 0.92,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'paint-navy',
    name: 'Navy accent',
    uses: ['wall'],
    category: 'wall',
    color: '#2f3d55',
    roughness: 0.9,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'paint-terracotta',
    name: 'Terracotta accent',
    uses: ['wall'],
    category: 'wall',
    color: '#c0785a',
    roughness: 0.9,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'exterior-render',
    name: 'Exterior render',
    uses: ['wall'],
    category: 'wall',
    color: '#d9d6cf',
    roughness: 0.95,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'wall-tile-ceramic',
    name: 'Ceramic wall tile',
    uses: ['wall'],
    category: 'ceramic',
    color: '#f1f1ee',
    roughness: 0.35,
    metalness: 0,
    pattern: 'tiles',
    patternSize: 0.3,
  }),
  // Floors
  m({
    id: 'floor-oak',
    name: 'Oak',
    uses: ['floor'],
    category: 'floor',
    color: '#b7864f',
    roughness: 0.55,
    metalness: 0,
    pattern: 'planks',
    patternSize: 1.2,
  }),
  m({
    id: 'floor-light-oak',
    name: 'Light oak',
    uses: ['floor'],
    category: 'floor',
    color: '#d4b48a',
    roughness: 0.55,
    metalness: 0,
    pattern: 'planks',
    patternSize: 1.2,
  }),
  m({
    id: 'floor-walnut',
    name: 'Walnut',
    uses: ['floor'],
    category: 'floor',
    color: '#6e4a2f',
    roughness: 0.5,
    metalness: 0,
    pattern: 'planks',
    patternSize: 1.2,
  }),
  m({
    id: 'floor-herringbone',
    name: 'Herringbone oak',
    uses: ['floor'],
    category: 'floor',
    color: '#c09463',
    roughness: 0.5,
    metalness: 0,
    pattern: 'herringbone',
    patternSize: 0.6,
  }),
  m({
    id: 'floor-tile',
    name: 'Porcelain tile',
    uses: ['floor'],
    category: 'floor',
    color: '#d8d6d0',
    roughness: 0.4,
    metalness: 0,
    pattern: 'tiles',
    patternSize: 0.6,
  }),
  m({
    id: 'floor-marble',
    name: 'Marble',
    uses: ['floor'],
    category: 'stone',
    color: '#ecebe8',
    roughness: 0.2,
    metalness: 0,
    pattern: 'marble',
    patternSize: 0.8,
  }),
  m({
    id: 'floor-concrete',
    name: 'Polished concrete',
    uses: ['floor'],
    category: 'floor',
    color: '#a9a8a4',
    roughness: 0.6,
    metalness: 0,
    pattern: 'concrete',
    patternSize: 2,
  }),
  m({
    id: 'floor-carpet',
    name: 'Carpet',
    uses: ['floor'],
    category: 'fabric',
    color: '#bdb5a8',
    roughness: 1,
    metalness: 0,
    pattern: 'carpet',
    patternSize: 0.5,
  }),
  m({
    id: 'floor-carpet-gray',
    name: 'Grey carpet',
    uses: ['floor'],
    category: 'fabric',
    color: '#8f9294',
    roughness: 1,
    metalness: 0,
    pattern: 'carpet',
    patternSize: 0.5,
  }),
  m({
    id: 'floor-bath-tile',
    name: 'Bathroom tile',
    uses: ['floor'],
    category: 'ceramic',
    color: '#c8ccd0',
    roughness: 0.35,
    metalness: 0,
    pattern: 'tiles',
    patternSize: 0.3,
  }),
  m({
    id: 'floor-stone',
    name: 'Stone',
    uses: ['floor'],
    category: 'stone',
    color: '#9c968c',
    roughness: 0.7,
    metalness: 0,
    pattern: 'tiles',
    patternSize: 0.6,
  }),
  m({
    id: 'floor-decking',
    name: 'Composite decking',
    uses: ['floor'],
    category: 'floor',
    color: '#7c6a58',
    roughness: 0.8,
    metalness: 0,
    pattern: 'planks',
    patternSize: 2.4,
  }),
  m({
    id: 'slab',
    name: 'Structural slab',
    uses: [],
    category: 'floor',
    color: '#8d8a84',
    roughness: 0.9,
    metalness: 0,
    pattern: 'none',
  }),
  // Ceilings
  m({
    id: 'ceiling-white',
    name: 'White ceiling',
    uses: ['ceiling'],
    category: 'ceiling',
    color: '#fbfbf9',
    roughness: 0.95,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'ceiling-warm',
    name: 'Warm white ceiling',
    uses: ['ceiling'],
    category: 'ceiling',
    color: '#f6efe2',
    roughness: 0.95,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'ceiling-wood',
    name: 'Wood slat ceiling',
    uses: ['ceiling'],
    category: 'wood',
    color: '#b98d5f',
    roughness: 0.7,
    metalness: 0,
    pattern: 'planks',
    patternSize: 1.5,
  }),
  // Joinery
  m({
    id: 'wood-oak',
    name: 'Oak',
    uses: ['door', 'trim', 'furniture'],
    category: 'wood',
    color: '#b98a57',
    roughness: 0.6,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'wood-walnut',
    name: 'Walnut',
    uses: ['door', 'trim', 'furniture'],
    category: 'wood',
    color: '#5f4029',
    roughness: 0.55,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'wood-white',
    name: 'White painted wood',
    uses: ['door', 'trim', 'furniture', 'window'],
    category: 'wood',
    color: '#f2f1ed',
    roughness: 0.6,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'wood-gray',
    name: 'Grey painted wood',
    uses: ['door', 'trim', 'furniture'],
    category: 'wood',
    color: '#8e9294',
    roughness: 0.6,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'upvc-white',
    name: 'White uPVC',
    uses: ['window'],
    category: 'wall',
    color: '#f5f5f3',
    roughness: 0.4,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'aluminium-dark',
    name: 'Dark aluminium',
    uses: ['window', 'door'],
    category: 'metal',
    color: '#3b3d40',
    roughness: 0.4,
    metalness: 0.6,
    pattern: 'none',
  }),
  m({
    id: 'glass',
    name: 'Glass',
    uses: [],
    category: 'glass',
    color: '#cfe3ee',
    roughness: 0.05,
    metalness: 0,
    pattern: 'none',
    opacity: 0.28,
  }),
  m({
    id: 'railing-glass',
    name: 'Glass balustrade',
    uses: [],
    category: 'glass',
    color: '#b9d3df',
    roughness: 0.1,
    metalness: 0.1,
    pattern: 'none',
    opacity: 0.35,
  }),
  // Kitchen & bathroom
  m({
    id: 'cabinet-white',
    name: 'White cabinet',
    uses: ['fixture', 'furniture'],
    category: 'cabinet',
    color: '#f0efeb',
    roughness: 0.45,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'cabinet-wood',
    name: 'Wood cabinet',
    uses: ['fixture', 'furniture'],
    category: 'cabinet',
    color: '#a77a4c',
    roughness: 0.55,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'cabinet-dark',
    name: 'Dark cabinet',
    uses: ['fixture', 'furniture'],
    category: 'cabinet',
    color: '#2f3134',
    roughness: 0.5,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'counter-marble',
    name: 'Marble countertop',
    uses: ['fixture'],
    category: 'countertop',
    color: '#eeedea',
    roughness: 0.2,
    metalness: 0,
    pattern: 'marble',
    patternSize: 0.8,
  }),
  m({
    id: 'counter-quartz',
    name: 'Quartz countertop',
    uses: ['fixture'],
    category: 'countertop',
    color: '#d9d7d2',
    roughness: 0.25,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'ceramic-white',
    name: 'White ceramic',
    uses: ['fixture'],
    category: 'ceramic',
    color: '#fbfbfb',
    roughness: 0.2,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'steel',
    name: 'Brushed steel',
    uses: ['fixture', 'furniture'],
    category: 'metal',
    color: '#b4b7ba',
    roughness: 0.35,
    metalness: 0.8,
    pattern: 'none',
  }),
  m({
    id: 'hob-black',
    name: 'Black glass hob',
    uses: ['fixture'],
    category: 'glass',
    color: '#151617',
    roughness: 0.15,
    metalness: 0.2,
    pattern: 'none',
  }),
  // Soft furnishings
  m({
    id: 'fabric-linen',
    name: 'Linen',
    uses: ['furniture'],
    category: 'fabric',
    color: '#b9ad9c',
    roughness: 0.95,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'fabric-sky',
    name: 'Sky blue fabric',
    uses: ['furniture'],
    category: 'fabric',
    color: '#8fd3ef',
    roughness: 0.95,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'fabric-rose',
    name: 'Rose fabric',
    uses: ['furniture'],
    category: 'fabric',
    color: '#efa9d6',
    roughness: 0.95,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'fabric-white',
    name: 'White fabric',
    uses: ['furniture'],
    category: 'fabric',
    color: '#f5f4f0',
    roughness: 0.95,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'fabric-slate',
    name: 'Slate fabric',
    uses: ['furniture'],
    category: 'fabric',
    color: '#cbd2d9',
    roughness: 0.95,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'fabric-charcoal',
    name: 'Charcoal fabric',
    uses: ['furniture'],
    category: 'fabric',
    color: '#4a4c50',
    roughness: 0.95,
    metalness: 0,
    pattern: 'none',
  }),
  m({
    id: 'leaf-green',
    name: 'Foliage',
    uses: [],
    category: 'plant',
    color: '#4f7a45',
    roughness: 0.8,
    metalness: 0,
    pattern: 'none',
  }),
];

const BY_ID = new Map(MATERIALS.map((d) => [d.id, d]));

export function getMaterialDef(id: string): MaterialDef | undefined {
  return BY_ID.get(id);
}

export const hasMaterial = (id: string): boolean => BY_ID.has(id);

export function materialsFor(use: MaterialUse): MaterialDef[] {
  return MATERIALS.filter((d) => d.uses.includes(use));
}

/** Resolve the effective colour: explicit override wins over the material's base colour. */
export function effectiveColor(materialId: string, override?: string): string {
  return override ?? getMaterialDef(materialId)?.color ?? '#ff00ff';
}

/** Swatch colours offered on furniture cards (from the Property Scanner design). */
export const FURNITURE_SWATCHES: readonly { materialId: string; color: string; label: string }[] = [
  { materialId: 'fabric-linen', color: '#a89a87', label: 'Taupe' },
  { materialId: 'fabric-sky', color: '#8fd3ef', label: 'Sky' },
  { materialId: 'fabric-rose', color: '#efa9d6', label: 'Rose' },
  { materialId: 'fabric-white', color: '#f5f4f0', label: 'White' },
  { materialId: 'fabric-slate', color: '#cbd2d9', label: 'Slate' },
];
