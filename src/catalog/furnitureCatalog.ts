import type { Dimensions3, FurnitureCategory, RoomType } from '../domain/types';

/**
 * Where the renderer gets geometry from. Procedural models are parametric (they rebuild
 * from the item's real dimensions); glTF assets are scaled to fit the item's dimensions.
 * Adding a glTF asset = add a catalog entry with `{ kind: 'gltf', url }`.
 */
export type FurnitureAsset =
  | { kind: 'procedural'; model: FurnitureCategory }
  | {
      kind: 'gltf';
      url: string;
      /** Native size of the asset, metres, used to derive scale. */ nativeDimensions: Dimensions3;
    };

export interface PlacementRules {
  /** Back of the item should touch a wall (sofas, beds, wardrobes…). */
  againstWall: boolean;
  /** Which wall the fitting engine tries first. */
  preferWall: 'longest' | 'any';
  /** Free space needed in front of the item (to sit, open doors, get into bed), metres. */
  frontClearance: number;
  /** Rugs and similar flat items don't collide with furniture placed on top. */
  collides: boolean;
  /** Room types where the item is typically used. Empty = anywhere. */
  roomTypes: RoomType[];
}

export interface FurnitureCatalogItem {
  id: string;
  name: string;
  category: FurnitureCategory;
  /** Extra words for search and natural-language matching. */
  keywords: string[];
  dimensions: Dimensions3;
  /** Allowed resize range per axis, metres. */
  resize: { min: Dimensions3; max: Dimensions3 };
  defaultMaterialId: string;
  /** Material ids offered as variants (swatches). */
  materialOptions: string[];
  asset: FurnitureAsset;
  placement: PlacementRules;
}

const FABRICS = [
  'fabric-linen',
  'fabric-sky',
  'fabric-rose',
  'fabric-white',
  'fabric-slate',
  'fabric-charcoal',
];
const WOODS = ['wood-oak', 'wood-walnut', 'wood-white', 'wood-gray'];

const LIVING: RoomType[] = ['living', 'kitchen-living'];
const BED: RoomType[] = ['bedroom'];

function item(
  id: string,
  name: string,
  category: FurnitureCategory,
  dims: [number, number, number],
  opts: {
    keywords?: string[];
    material: string;
    materials: string[];
    placement: Partial<PlacementRules>;
    resize?: [number, number];
  },
): FurnitureCatalogItem {
  const [width, depth, height] = dims;
  const [lo, hi] = opts.resize ?? [0.7, 1.4];
  return {
    id,
    name,
    category,
    keywords: opts.keywords ?? [],
    dimensions: { width, depth, height },
    resize: {
      min: {
        width: +(width * lo).toFixed(2),
        depth: +(depth * lo).toFixed(2),
        height: +(height * lo).toFixed(2),
      },
      max: {
        width: +(width * hi).toFixed(2),
        depth: +(depth * hi).toFixed(2),
        height: +(height * hi).toFixed(2),
      },
    },
    defaultMaterialId: opts.material,
    materialOptions: opts.materials,
    asset: { kind: 'procedural', model: category },
    placement: {
      againstWall: false,
      preferWall: 'any',
      frontClearance: 0,
      collides: true,
      roomTypes: [],
      ...opts.placement,
    },
  };
}

/** Typical UK retail dimensions (width × depth × height, metres). */
export const FURNITURE_CATALOG: readonly FurnitureCatalogItem[] = [
  item('armchair', 'Armchair', 'armchair', [0.85, 0.85, 0.85], {
    keywords: ['chair', 'accent chair', 'lounge chair'],
    material: 'fabric-linen',
    materials: FABRICS,
    placement: { frontClearance: 0.45, roomTypes: [...LIVING, 'bedroom'] },
  }),
  item('sofa-3', '3-seat sofa', 'sofa', [2.2, 0.9, 0.85], {
    keywords: ['sofa', 'couch', 'settee', 'three seat', '3 seat', '3-seater', 'three seater'],
    material: 'fabric-linen',
    materials: FABRICS,
    placement: { againstWall: true, preferWall: 'longest', frontClearance: 0.6, roomTypes: LIVING },
  }),
  item('sofa-2', '2-seat sofa', 'sofa', [1.6, 0.88, 0.85], {
    keywords: ['loveseat', 'two seat', '2 seat', '2-seater', 'small sofa'],
    material: 'fabric-linen',
    materials: FABRICS,
    placement: { againstWall: true, preferWall: 'longest', frontClearance: 0.6, roomTypes: LIVING },
  }),
  item('bed-king', 'King-size bed', 'bed', [1.6, 2.1, 1.05], {
    keywords: ['king bed', 'king size', 'kingsize'],
    material: 'fabric-white',
    materials: FABRICS,
    placement: { againstWall: true, preferWall: 'longest', frontClearance: 0.6, roomTypes: BED },
    resize: [0.9, 1.1],
  }),
  item('bed-double', 'Double bed', 'bed', [1.45, 2.05, 1.0], {
    keywords: ['bed', 'double'],
    material: 'fabric-white',
    materials: FABRICS,
    placement: { againstWall: true, preferWall: 'longest', frontClearance: 0.6, roomTypes: BED },
    resize: [0.9, 1.1],
  }),
  item('bed-single', 'Single bed', 'bed', [1.0, 2.0, 0.9], {
    keywords: ['single', 'kids bed'],
    material: 'fabric-white',
    materials: FABRICS,
    placement: { againstWall: true, preferWall: 'any', frontClearance: 0.6, roomTypes: BED },
    resize: [0.9, 1.1],
  }),
  item('bedside-table', 'Bedside table', 'bedside-table', [0.45, 0.4, 0.55], {
    keywords: ['nightstand', 'bedside'],
    material: 'wood-oak',
    materials: WOODS,
    placement: { againstWall: true, roomTypes: BED },
  }),
  item('dining-table-4', 'Dining table (4)', 'dining-table', [1.2, 0.8, 0.75], {
    keywords: ['dining table', 'table', 'kitchen table'],
    material: 'wood-oak',
    materials: WOODS,
    placement: { frontClearance: 0.75, roomTypes: [...LIVING, 'dining', 'kitchen'] },
  }),
  item('dining-table-6', 'Dining table (6)', 'dining-table', [1.8, 0.9, 0.75], {
    keywords: ['large dining table', 'six seat table'],
    material: 'wood-walnut',
    materials: WOODS,
    placement: { frontClearance: 0.75, roomTypes: [...LIVING, 'dining'] },
  }),
  item('dining-chair', 'Dining chair', 'dining-chair', [0.45, 0.5, 0.85], {
    keywords: ['chair', 'kitchen chair'],
    material: 'wood-oak',
    materials: WOODS,
    placement: { roomTypes: [...LIVING, 'dining', 'kitchen'] },
  }),
  item('coffee-table', 'Coffee table', 'coffee-table', [1.1, 0.6, 0.42], {
    keywords: ['coffee', 'low table'],
    material: 'wood-oak',
    materials: WOODS,
    placement: { roomTypes: LIVING },
  }),
  item('tv-unit', 'TV unit', 'tv-unit', [1.6, 0.42, 0.5], {
    keywords: ['tv', 'television', 'media unit', 'tv stand', 'media console'],
    material: 'wood-walnut',
    materials: WOODS,
    placement: {
      againstWall: true,
      preferWall: 'any',
      frontClearance: 1.5,
      roomTypes: [...LIVING, 'bedroom'],
    },
  }),
  item('wardrobe', 'Wardrobe', 'wardrobe', [1.0, 0.6, 2.0], {
    keywords: ['closet', 'armoire'],
    material: 'wood-white',
    materials: WOODS,
    placement: { againstWall: true, frontClearance: 0.7, roomTypes: BED },
    resize: [0.5, 2],
  }),
  item('desk', 'Desk', 'desk', [1.2, 0.6, 0.75], {
    keywords: ['work desk', 'study desk', 'office'],
    material: 'wood-oak',
    materials: WOODS,
    placement: { againstWall: true, frontClearance: 0.8, roomTypes: ['bedroom', ...LIVING] },
  }),
  item('office-chair', 'Office chair', 'office-chair', [0.6, 0.6, 1.0], {
    keywords: ['desk chair', 'task chair'],
    material: 'fabric-charcoal',
    materials: FABRICS,
    placement: { roomTypes: ['bedroom', ...LIVING] },
  }),
  item('bookshelf', 'Bookshelf', 'bookshelf', [0.8, 0.32, 1.8], {
    keywords: ['bookcase', 'shelves', 'shelf'],
    material: 'wood-oak',
    materials: WOODS,
    placement: { againstWall: true, frontClearance: 0.5 },
  }),
  item('sideboard', 'Sideboard', 'cabinet', [1.5, 0.45, 0.8], {
    keywords: ['cabinet', 'buffet', 'credenza', 'chest of drawers', 'drawers'],
    material: 'wood-walnut',
    materials: WOODS,
    placement: { againstWall: true, frontClearance: 0.6 },
  }),
  item('rug', 'Rug', 'rug', [2.0, 1.4, 0.01], {
    keywords: ['carpet', 'mat'],
    material: 'fabric-slate',
    materials: FABRICS,
    placement: { collides: false },
    resize: [0.5, 1.8],
  }),
  item('floor-lamp', 'Floor lamp', 'lamp', [0.35, 0.35, 1.6], {
    keywords: ['lamp', 'standing lamp', 'reading lamp'],
    material: 'steel',
    materials: ['steel', 'wood-oak', 'wood-walnut'],
    placement: {},
  }),
  item('plant', 'Plant', 'plant', [0.45, 0.45, 1.2], {
    keywords: ['plant', 'pot plant', 'houseplant', 'greenery'],
    material: 'leaf-green',
    materials: ['leaf-green'],
    placement: {},
  }),
];

const BY_ID = new Map(FURNITURE_CATALOG.map((c) => [c.id, c]));

export function getCatalogItem(id: string): FurnitureCatalogItem | undefined {
  return BY_ID.get(id);
}

export function searchCatalog(query: string): FurnitureCatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...FURNITURE_CATALOG];
  return FURNITURE_CATALOG.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.category.includes(q) ||
      c.keywords.some((k) => k.includes(q) || q.includes(k)),
  );
}
