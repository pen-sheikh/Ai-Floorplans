import { FURNITURE_CATALOG } from '../catalog/furnitureCatalog';
import { RENOVATION_PRESETS } from '../catalog/renovationPresets';
import type { LightingPreset, RoomRenovation, RoomType } from '../domain/types';
import type { Intent, IntentContext, IntentProvider } from './intents';

/**
 * Offline, deterministic natural-language → intent parser. It covers the common phrasings
 * and is the fallback when no LLM provider is configured. It only emits intents; it never
 * edits the model.
 */
export class RuleBasedIntentProvider implements IntentProvider {
  readonly name = 'rule-based';
  async parse(text: string, context: IntentContext): Promise<Intent[]> {
    return parseIntents(text, context);
  }
}

const TYPE_ALIASES: [string, RoomType[]][] = [
  ['living room', ['living', 'kitchen-living']],
  ['lounge', ['living', 'kitchen-living']],
  ['sitting room', ['living', 'kitchen-living']],
  ['living area', ['living', 'kitchen-living']],
  ['open plan', ['kitchen-living']],
  ['open-plan', ['kitchen-living']],
  ['kitchen', ['kitchen', 'kitchen-living']],
  ['diner', ['dining', 'kitchen-living']],
  ['dining room', ['dining', 'kitchen-living']],
  ['dining area', ['dining', 'kitchen-living']],
  ['bathroom', ['bathroom']],
  ['toilet', ['toilet', 'bathroom']],
  ['hallway', ['hall']],
  ['corridor', ['hall']],
  ['hall', ['hall']],
  ['entrance', ['hall']],
  ['balcony', ['balcony']],
  ['terrace', ['balcony']],
];

const ORDINALS: Record<string, number> = {
  '1': 0,
  one: 0,
  first: 0,
  '2': 1,
  two: 1,
  second: 1,
  '3': 2,
  three: 2,
  third: 2,
};

export interface RoomMatch {
  ids: string[];
  /** Explanation when an ambiguous phrase was resolved by a rule. */
  note?: string;
}

/** Resolve a room reference in free text. Bedrooms are ranked by area for "master/largest/second". */
export function matchRooms(text: string, ctx: IntentContext): RoomMatch | null {
  const t = text.toLowerCase();
  if (/\b(all rooms|every room|everywhere|whole (flat|apartment|place)|entire (flat|apartment))\b/.test(t)) {
    return { ids: ctx.rooms.filter((r) => r.type !== 'storage').map((r) => r.id) };
  }
  if (/\bhere\b|\bthis room\b/.test(t) && ctx.selectedRoomId) return { ids: [ctx.selectedRoomId] };

  // Exact room names first (longest first, so "bedroom 2" beats "bedroom").
  const byName = [...ctx.rooms]
    .sort((a, b) => b.name.length - a.name.length)
    .find((r) => t.includes(r.name.toLowerCase()));
  if (byName && !/^bedroom$/i.test(byName.name)) return { ids: [byName.id] };

  const bedrooms = ctx.rooms.filter((r) => r.type === 'bedroom').sort((a, b) => b.areaM2 - a.areaM2);
  const bedroomRef = t.match(
    /\b(master|main|largest|biggest|big|smallest|small|second|first|third|spare)?\s*bed\s?room\s*(\d|one|two|three)?\b/,
  );
  if (bedroomRef && bedrooms.length) {
    const [, qualifier, num] = bedroomRef;
    if (num !== undefined) {
      const named = bedrooms.find((b) => b.name.toLowerCase().endsWith(` ${ORDINALS[num]! + 1}`));
      if (named) return { ids: [named.id] };
    }
    if (qualifier && /small|second|spare/.test(qualifier)) {
      const pick = bedrooms[Math.min(1, bedrooms.length - 1)]!;
      return { ids: [pick.id], note: `Using ${pick.name} (the smaller bedroom).` };
    }
    const pick = bedrooms[0]!;
    if (bedrooms.length > 1 && !qualifier) {
      return {
        ids: [pick.id],
        note: `There are ${bedrooms.length} bedrooms; I used ${pick.name} (the largest). Say "${bedrooms[1]!.name}" for the other.`,
      };
    }
    return { ids: [pick.id] };
  }

  for (const [alias, types] of TYPE_ALIASES) {
    if (new RegExp(`\\b${alias}\\b`).test(t)) {
      const room = ctx.rooms.find((r) => types.includes(r.type));
      if (room) return { ids: [room.id] };
    }
  }
  return null;
}

/** A trailing category noun belongs to the same mention ("king size bed", "3 seat sofa"). */
const NOUN_SUFFIX = '(?:sofa|couch|bed|table|chair|unit|lamp|desk|shelf|wardrobe)s?';

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  pair: 2,
};

/** Furniture mentions in order, longest phrase wins ("3-seat sofa" before "sofa"). */
export function matchFurniture(text: string): string[] {
  const t = ` ${text.toLowerCase().replace(/[,.!?;]/g, ' ')} `;
  const phrases: { phrase: string; id: string }[] = FURNITURE_CATALOG.flatMap((c) =>
    [c.name.toLowerCase(), ...c.keywords].map((phrase) => ({ phrase, id: c.id })),
  ).sort((a, b) => b.phrase.length - a.phrase.length);
  const taken: [number, number][] = [];
  const hits: { at: number; id: string; count: number }[] = [];
  for (const { phrase, id } of phrases) {
    const re = new RegExp(
      `(?:\\b(\\d|${Object.keys(NUMBER_WORDS).join('|')})\\s+)?\\b${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:e?s)?(?:\\s+${NOUN_SUFFIX})?\\b`,
      'g',
    );
    for (const m of t.matchAll(re)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      const q = m[1];
      const count = q === undefined ? 1 : Number.isFinite(Number(q)) ? Number(q) : (NUMBER_WORDS[q] ?? 1);
      hits.push({ at: start, id, count: Math.min(Math.max(count, 1), 8) });
    }
  }
  return hits.sort((a, b) => a.at - b.at).flatMap((h) => Array<string>(h.count).fill(h.id));
}

const FLOOR_WORDS: [RegExp, string][] = [
  [/herringbone|parquet/, 'floor-herringbone'],
  [/light oak|pale wood|light wood/, 'floor-light-oak'],
  [/walnut|dark wood/, 'floor-walnut'],
  [/marble/, 'floor-marble'],
  [/concrete/, 'floor-concrete'],
  [/grey carpet|gray carpet/, 'floor-carpet-gray'],
  [/carpet/, 'floor-carpet'],
  [/porcelain|tiles?\b/, 'floor-tile'],
  [/stone|slate/, 'floor-stone'],
  [/oak|wood|timber|hardwood|laminate/, 'floor-oak'],
];

const WALL_WORDS: [RegExp, string][] = [
  [/light beige|beige|sand|taupe/, 'paint-beige'],
  [/cream|ivory|off[- ]white|magnolia/, 'paint-cream'],
  [/grey|gray/, 'paint-gray'],
  [/sage|green/, 'paint-sage'],
  [/navy|blue/, 'paint-navy'],
  [/terracotta|orange|rust/, 'paint-terracotta'],
  [/tiles?\b|tiled/, 'wall-tile-ceramic'],
  [/white/, 'paint-white'],
];

const CEILING_WORDS: [RegExp, string][] = [
  [/wood|timber|slat/, 'ceiling-wood'],
  [/warm/, 'ceiling-warm'],
  [/white/, 'ceiling-white'],
];

const LIGHT_WORDS: [RegExp, LightingPreset][] = [
  [/warm (light|lighting|glow)|cosy light|cozy light/, 'warm'],
  [/cool (light|lighting)|daylight bulbs?|bright (light|lighting)/, 'cool'],
  [/neutral (light|lighting)/, 'neutral'],
  [/lights? off|turn off the lights?/, 'off'],
];

const SUBJECTS = [/\bfloor(ing|s)?\b/, /\bwalls?\b|\bpaint(ed)?\b/, /\bceilings?\b/];

/**
 * The clause of `text` that talks about `subject` (e.g. "warm wood flooring"). If it names no
 * material ("replace the flooring with marble"), the next clause is used unless that clause is
 * about a different surface.
 */
function clausesAbout(text: string, subject: RegExp): string[] {
  const parts = text.split(/,|\band\b|\bwith\b|\bto\b|;/);
  const i = parts.findIndex((p) => subject.test(p));
  if (i < 0) return [];
  const next = parts[i + 1];
  const nextIsOther = next !== undefined && SUBJECTS.some((s) => s !== subject && s.test(next));
  return next !== undefined && !nextIsOther ? [parts[i]!, next] : [parts[i]!];
}

const firstMatch = <T>(texts: string | string[] | null, table: [RegExp, T][]): T | undefined => {
  for (const text of Array.isArray(texts) ? texts : texts ? [texts] : []) {
    const hit = table.find(([re]) => re.test(text))?.[1];
    if (hit !== undefined) return hit;
  }
  return undefined;
};

export function parseRenovationPatch(text: string): Partial<RoomRenovation> {
  const t = text.toLowerCase();
  const patch: Partial<RoomRenovation> = {};
  const [floorRe, wallRe, ceilingRe] = SUBJECTS as [RegExp, RegExp, RegExp];
  const floorClause = clausesAbout(t, floorRe);
  const wallClause = clausesAbout(t, wallRe);
  const ceilingClause = clausesAbout(t, ceilingRe);
  const floor = firstMatch(floorClause, FLOOR_WORDS);
  const wall = firstMatch(wallClause, WALL_WORDS);
  const ceiling = firstMatch(ceilingClause, CEILING_WORDS);
  if (floor) patch.floorMaterialId = floor;
  if (wall) patch.wallMaterialId = wall;
  if (ceiling) patch.ceilingMaterialId = ceiling;
  const hex = wallClause.join(' ').match(/#[0-9a-f]{6}\b/i)?.[0];
  if (hex) patch.wallColor = hex.toLowerCase();
  const light = firstMatch(t, LIGHT_WORDS);
  if (light) patch.lighting = light;
  return patch;
}

export function matchPreset(text: string): string | undefined {
  const t = text.toLowerCase();
  return RENOVATION_PRESETS.find((p) => p.keywords.some((k) => new RegExp(`\\b${k}\\b`).test(t)))?.id;
}

const isQuestion = (t: string) =>
  /\b(can|could|will|would|does|do|is there)\b[^.]*\bfit\b|\broom for\b/.test(t);
const isRemoval = (t: string) => /\b(remove|delete|get rid of|take out|clear)\b/.test(t);
const isRenovation = (t: string) =>
  /\b(renovate|redecorate|refurbish|redo|repaint|paint|make|style|look|feel|replace|change|switch)\b/.test(
    t,
  ) &&
  /\b(floor|flooring|walls?|paint|ceiling|style|look|feel|scandinavian|scandi|industrial|luxe|luxury|modern|larger|bigger|brighter|light(ing)?)\b/.test(
    t,
  );
const isDescribe = (t: string) => /\b(describe|tell me about|how big|what('s| is) the (size|area))\b/.test(t);

/** Parse free text into zero or more intents (never throws). */
export function parseIntents(text: string, ctx: IntentContext): Intent[] {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const rooms = matchRooms(t, ctx);
  const furniture = matchFurniture(t);
  const fallbackRoom = (): string | undefined => {
    if (ctx.selectedRoomId) return ctx.selectedRoomId;
    const first = FURNITURE_CATALOG.find((c) => c.id === furniture[0]);
    const types = first?.placement.roomTypes ?? [];
    return ctx.rooms.find((r) => types.includes(r.type))?.id;
  };

  if (isQuestion(t) && furniture.length) {
    const roomId = rooms?.ids[0] ?? fallbackRoom();
    if (!roomId) return [{ action: 'unknown', text, reason: 'Which room should I check?' }];
    return [{ action: 'check_fit', roomId, furniture: furniture[0]! }];
  }

  if (isRemoval(t) && furniture.length) {
    return [...new Set(furniture)].map((f) => ({
      action: 'remove_furniture',
      furniture: f,
      ...(rooms ? { roomId: rooms.ids[0]! } : {}),
    }));
  }

  if (isRenovation(t) && (!furniture.length || /\b(floor|flooring|walls?|ceiling)\b/.test(t))) {
    const roomIds = rooms?.ids ?? (ctx.selectedRoomId ? [ctx.selectedRoomId] : []);
    if (!roomIds.length) return [{ action: 'unknown', text, reason: 'Which room should I renovate?' }];
    const patch = parseRenovationPatch(t);
    const preset = matchPreset(t);
    // Explicit materials beat style keywords ("warm wood flooring" is not the warm-modern preset).
    const materialFields = Object.keys(patch).filter((k) => k !== 'lighting');
    if (materialFields.length === 0 && preset)
      return [{ action: 'renovate', roomIds, preset, ...(patch.lighting ? { patch } : {}) }];
    if (Object.keys(patch).length) return [{ action: 'renovate', roomIds, patch }];
    return [
      {
        action: 'unknown',
        text,
        reason: 'I could not tell which finish to change. Try "oak flooring" or "light beige walls".',
      },
    ];
  }

  if (furniture.length && /\b(put|place|add|fit|furnish|insert|want|need|get|arrange|move in)\b/.test(t)) {
    const roomId = rooms?.ids[0] ?? fallbackRoom();
    if (!roomId) return [{ action: 'unknown', text, reason: 'Which room should it go in?' }];
    return [
      {
        action: 'place_furniture',
        roomId,
        furniture,
        ...(/\blongest wall\b/.test(t) ? { placement: 'longest_wall' as const } : {}),
        constraints: { preserveDoorClearance: true, preserveWindowAccess: true },
      },
    ];
  }

  if (isDescribe(t) && rooms) return [{ action: 'describe_room', roomId: rooms.ids[0]! }];

  return [
    {
      action: 'unknown',
      text,
      reason: 'I can place furniture, check whether something fits, remove furniture, or renovate a room.',
    },
  ];
}
