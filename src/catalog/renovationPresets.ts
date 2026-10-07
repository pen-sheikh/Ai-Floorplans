import type { RoomRenovation, RoomType } from '../domain/types';

const BASE: RoomRenovation = {
  wallMaterialId: 'paint-white',
  floorMaterialId: 'floor-oak',
  ceilingMaterialId: 'ceiling-white',
  trimMaterialId: 'wood-white',
  doorMaterialId: 'wood-white',
  windowMaterialId: 'upvc-white',
  lighting: 'neutral',
};

/**
 * Starting finishes per room type. The plan says nothing about finishes, so these are
 * neutral defaults chosen for legibility — not claims about the real flat.
 */
export function defaultRenovation(type: RoomType): RoomRenovation {
  switch (type) {
    case 'bathroom':
    case 'toilet':
      return {
        ...BASE,
        wallMaterialId: 'wall-tile-ceramic',
        floorMaterialId: 'floor-bath-tile',
        lighting: 'cool',
      };
    case 'kitchen':
      return { ...BASE, floorMaterialId: 'floor-tile' };
    case 'bedroom':
      return { ...BASE, floorMaterialId: 'floor-carpet', lighting: 'warm' };
    case 'balcony':
      return {
        ...BASE,
        wallMaterialId: 'exterior-render',
        floorMaterialId: 'floor-decking',
        lighting: 'off',
      };
    case 'storage':
    case 'utility':
      return { ...BASE, floorMaterialId: 'floor-carpet-gray', lighting: 'off' };
    default:
      return { ...BASE };
  }
}

export interface RenovationPreset {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  /** Applied to dry rooms (everything except wet rooms and outside space). */
  patch: Partial<RoomRenovation>;
  /** Optional variant for bathrooms/toilets. */
  wetRoomPatch?: Partial<RoomRenovation>;
}

export const RENOVATION_PRESETS: readonly RenovationPreset[] = [
  {
    id: 'scandinavian',
    name: 'Scandinavian',
    description: 'Light oak floors, white walls, warm light.',
    keywords: ['scandinavian', 'scandi', 'nordic', 'hygge'],
    patch: {
      wallMaterialId: 'paint-white',
      floorMaterialId: 'floor-light-oak',
      ceilingMaterialId: 'ceiling-white',
      doorMaterialId: 'wood-white',
      lighting: 'warm',
    },
    wetRoomPatch: { wallMaterialId: 'wall-tile-ceramic', floorMaterialId: 'floor-tile' },
  },
  {
    id: 'warm-modern',
    name: 'Warm modern',
    description: 'Walnut floors, light beige walls, oak doors.',
    keywords: ['warm', 'cosy', 'cozy', 'modern', 'walnut'],
    patch: {
      wallMaterialId: 'paint-beige',
      floorMaterialId: 'floor-walnut',
      ceilingMaterialId: 'ceiling-warm',
      doorMaterialId: 'wood-oak',
      lighting: 'warm',
    },
    wetRoomPatch: { floorMaterialId: 'floor-stone' },
  },
  {
    id: 'industrial',
    name: 'Industrial',
    description: 'Polished concrete, soft grey walls, dark frames.',
    keywords: ['industrial', 'loft', 'concrete', 'urban'],
    patch: {
      wallMaterialId: 'paint-gray',
      floorMaterialId: 'floor-concrete',
      doorMaterialId: 'wood-gray',
      windowMaterialId: 'aluminium-dark',
      lighting: 'neutral',
    },
    wetRoomPatch: { floorMaterialId: 'floor-concrete' },
  },
  {
    id: 'classic-luxe',
    name: 'Classic luxe',
    description: 'Herringbone parquet, cream walls, marble in wet rooms.',
    keywords: ['luxury', 'luxe', 'classic', 'elegant', 'herringbone', 'parisian'],
    patch: {
      wallMaterialId: 'paint-cream',
      floorMaterialId: 'floor-herringbone',
      ceilingMaterialId: 'ceiling-warm',
      doorMaterialId: 'wood-white',
      lighting: 'warm',
    },
    wetRoomPatch: { floorMaterialId: 'floor-marble', wallMaterialId: 'wall-tile-ceramic' },
  },
  {
    id: 'bright-airy',
    name: 'Bright & airy',
    description: 'Light surfaces and cool light to make a room feel larger.',
    keywords: ['larger', 'bigger', 'spacious', 'bright', 'airy', 'light', 'open'],
    patch: {
      wallMaterialId: 'paint-white',
      floorMaterialId: 'floor-light-oak',
      ceilingMaterialId: 'ceiling-white',
      lighting: 'cool',
    },
    wetRoomPatch: { floorMaterialId: 'floor-tile' },
  },
];

export function getRenovationPreset(id: string): RenovationPreset | undefined {
  return RENOVATION_PRESETS.find((p) => p.id === id);
}

/** The finishes a preset sets for a room of the given type. Outdoor rooms are left alone. */
export function presetPatchFor(preset: RenovationPreset, type: RoomType): Partial<RoomRenovation> {
  if (type === 'balcony') return {};
  if (type === 'bathroom' || type === 'toilet') return { ...preset.patch, ...(preset.wetRoomPatch ?? {}) };
  return preset.patch;
}
