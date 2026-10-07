import { FURNITURE_CATALOG, getCatalogItem } from '../catalog/furnitureCatalog';
import { hasMaterial, MATERIALS } from '../catalog/materials';
import { RENOVATION_PRESETS } from '../catalog/renovationPresets';
import { roomMetrics } from '../domain/topology';
import type { Apartment, LightingPreset, RoomRenovation, RoomType } from '../domain/types';

/**
 * Structured intents: the ONLY output an AI model is allowed to produce. They reference
 * model entities by id and are executed by deterministic code (`executeIntent`).
 */
export type Intent =
  | {
      action: 'place_furniture';
      roomId: string;
      furniture: string[];
      placement?: 'longest_wall' | 'any';
      constraints?: IntentConstraints;
    }
  | { action: 'check_fit'; roomId: string; furniture: string }
  | { action: 'renovate'; roomIds: string[]; preset?: string; patch?: Partial<RoomRenovation> }
  | { action: 'remove_furniture'; roomId?: string; furniture: string }
  | { action: 'describe_room'; roomId: string }
  | { action: 'unknown'; text: string; reason: string };

export type IntentAction = Intent['action'];

/** Per-request rule changes an assistant may ask for. All are validated and bounded. */
export interface IntentConstraints {
  /** Treat door access zones as hard (no furniture in front of doors). */
  preserveDoorClearance?: boolean;
  /** Treat window access zones as hard. */
  preserveWindowAccess?: boolean;
  /** Minimum walkway in front of items, metres (0.3–2.0). */
  minimumWalkway?: number;
  /** Clear depth in front of doors, metres (0.3–2.0). */
  doorClearance?: number;
}

/** Public names for the assistant boundary. */
export type AssistantIntent = Intent;

/** Everything a model needs to know to emit valid intents (serialisable for an LLM prompt). */
export interface IntentContext {
  rooms: { id: string; name: string; type: RoomType; areaM2: number; furniture: string[] }[];
  furnitureCatalog: { id: string; name: string; category: string; dimensions: string }[];
  materials: { id: string; name: string; uses: string[] }[];
  presets: { id: string; name: string; description: string }[];
  lighting: LightingPreset[];
  selectedRoomId?: string;
}

export function buildIntentContext(apt: Apartment, selectedRoomId?: string): IntentContext {
  const floor = apt.floors[0]!;
  return {
    rooms: floor.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      areaM2: +roomMetrics(r).area.toFixed(1),
      furniture: floor.furniture.filter((f) => f.roomId === r.id).map((f) => f.name),
    })),
    furnitureCatalog: FURNITURE_CATALOG.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      dimensions: `${c.dimensions.width}×${c.dimensions.depth}×${c.dimensions.height} m`,
    })),
    materials: MATERIALS.filter((m) => m.uses.length).map((m) => ({ id: m.id, name: m.name, uses: m.uses })),
    presets: RENOVATION_PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description })),
    lighting: ['warm', 'neutral', 'cool', 'off'],
    ...(selectedRoomId ? { selectedRoomId } : {}),
  };
}

/** A source of intents. The rule-based provider works offline; an LLM provider can replace it. */
export interface IntentProvider {
  readonly name: string;
  parse(text: string, context: IntentContext): Promise<Intent[]>;
}

/** Reject intents that reference things that don't exist — never trust model output blindly. */
export function validateIntent(intent: Intent, ctx: IntentContext): string[] {
  const errors: string[] = [];
  const roomIds = new Set(ctx.rooms.map((r) => r.id));
  const checkRoom = (id: string | undefined) => {
    if (id !== undefined && !roomIds.has(id)) errors.push(`Unknown room "${id}".`);
  };
  switch (intent.action) {
    case 'place_furniture':
      checkRoom(intent.roomId);
      if (intent.furniture.length === 0) errors.push('No furniture specified.');
      for (const f of intent.furniture) if (!getCatalogItem(f)) errors.push(`Unknown furniture "${f}".`);
      break;
    case 'check_fit':
      checkRoom(intent.roomId);
      if (!getCatalogItem(intent.furniture)) errors.push(`Unknown furniture "${intent.furniture}".`);
      break;
    case 'renovate':
      if (intent.roomIds.length === 0) errors.push('No room specified.');
      intent.roomIds.forEach(checkRoom);
      if (intent.preset && !RENOVATION_PRESETS.some((p) => p.id === intent.preset))
        errors.push(`Unknown style "${intent.preset}".`);
      for (const [k, v] of Object.entries(intent.patch ?? {})) {
        if (k.endsWith('MaterialId') && typeof v === 'string' && !hasMaterial(v))
          errors.push(`Unknown material "${v}".`);
        if (k.endsWith('Color') && typeof v === 'string' && !/^#[0-9a-f]{6}$/i.test(v))
          errors.push(`Invalid colour "${v}".`);
      }
      if (!intent.preset && Object.keys(intent.patch ?? {}).length === 0) errors.push('Nothing to change.');
      break;
    case 'remove_furniture':
      checkRoom(intent.roomId);
      break;
    case 'describe_room':
      checkRoom(intent.roomId);
      break;
    case 'unknown':
      break;
  }
  return errors;
}
