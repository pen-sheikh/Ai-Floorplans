import { getCatalogItem } from '../catalog/furnitureCatalog';
import { materialsFor, type MaterialUse } from '../catalog/materials';
import { RENOVATION_PRESETS } from '../catalog/renovationPresets';
import type { LightingPreset, RoomRenovation } from '../domain/types';
import type { Intent, IntentConstraints, IntentContext, IntentProvider } from './intents';
import { matchFurniture, matchRooms } from './ruleBasedProvider';

/**
 * The JSON contract a language model must return. The model never sees or touches the scene;
 * its output is parsed here, strictly validated against the current apartment and catalogs,
 * and only then turned into `Intent`s for the deterministic engine.
 *
 *   { "intent": "fit_furniture", "room": "living-room",
 *     "items": [{ "type": "three-seat-sofa", "quantity": 1 }],
 *     "constraints": { "minimumWalkway": 0.6 } }
 */
export const ASSISTANT_CONTRACT_VERSION = 1;

export interface AssistantIntentJson {
  intent: 'fit_furniture' | 'check_fit' | 'renovate' | 'remove_furniture' | 'describe_room';
  /** Room id, name or common alias ("living room", "master bedroom"). */
  room?: string;
  /** Several rooms (renovate only). "all" = every non-storage room. */
  rooms?: string[] | 'all';
  /** Furniture: catalog id or a name the catalog recognises. */
  items?: { type: string; quantity?: number }[];
  style?: string;
  finishes?: { floor?: string; walls?: string; wallColor?: string; ceiling?: string; lighting?: string };
  placement?: 'longest_wall' | 'any';
  constraints?: {
    minimumWalkway?: number;
    doorClearance?: number;
    keepDoorsClear?: boolean;
    keepWindowsClear?: boolean;
  };
}

export type ParseResult = { ok: true; intents: Intent[] } | { ok: false; errors: string[] };

const LIMITS = {
  maxChars: 20_000,
  maxIntents: 5,
  maxQuantity: 8,
  maxItems: 12,
  clearance: [0.3, 2.0] as const,
};

const INTENT_KEYS: Record<AssistantIntentJson['intent'], string[]> = {
  fit_furniture: ['intent', 'room', 'items', 'placement', 'constraints'],
  check_fit: ['intent', 'room', 'items', 'constraints'],
  renovate: ['intent', 'room', 'rooms', 'style', 'finishes'],
  remove_furniture: ['intent', 'room', 'items'],
  describe_room: ['intent', 'room'],
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse model output (string or already-parsed JSON). Rejects — never repairs — anything
 * unexpected: unknown intents or keys, unknown rooms/furniture/materials, out-of-range numbers,
 * oversized payloads. Returns every error found so a model can be re-prompted with them.
 */
export function parseAssistantJson(raw: unknown, ctx: IntentContext): ParseResult {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.maxChars) return { ok: false, errors: ['Response too large.'] };
    const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { ok: false, errors: ['Response is not valid JSON.'] };
    }
  }
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) return { ok: false, errors: ['No intent returned.'] };
  if (list.length > LIMITS.maxIntents)
    return { ok: false, errors: [`At most ${LIMITS.maxIntents} intents per response.`] };

  const errors: string[] = [];
  const intents: Intent[] = [];
  list.forEach((item, i) => {
    const res = parseOne(item, ctx);
    if (res.ok) intents.push(res.intent);
    else errors.push(...res.errors.map((e) => (list.length > 1 ? `[${i}] ${e}` : e)));
  });
  return errors.length ? { ok: false, errors } : { ok: true, intents };
}

function parseOne(
  v: unknown,
  ctx: IntentContext,
): { ok: true; intent: Intent } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ['Intent must be a JSON object.'] };
  const kind = v.intent;
  if (typeof kind !== 'string' || !(kind in INTENT_KEYS)) {
    return {
      ok: false,
      errors: [`Unknown intent ${JSON.stringify(kind)}. Allowed: ${Object.keys(INTENT_KEYS).join(', ')}.`],
    };
  }
  const allowed = INTENT_KEYS[kind as AssistantIntentJson['intent']];
  for (const key of Object.keys(v))
    if (!allowed.includes(key)) errors.push(`Unexpected field "${key}" for ${kind}.`);

  const room = (): string | undefined => {
    if (v.room === undefined) {
      if (ctx.selectedRoomId) return ctx.selectedRoomId;
      errors.push('"room" is required.');
      return undefined;
    }
    if (typeof v.room !== 'string' || !v.room.trim()) {
      errors.push('"room" must be a non-empty string.');
      return undefined;
    }
    const id = resolveRoom(v.room, ctx);
    if (!id) errors.push(`Unknown room "${v.room}". Known rooms: ${ctx.rooms.map((r) => r.id).join(', ')}.`);
    return id;
  };

  const items = (): string[] => {
    if (!Array.isArray(v.items) || v.items.length === 0) {
      errors.push('"items" must be a non-empty array.');
      return [];
    }
    const out: string[] = [];
    for (const it of v.items) {
      if (!isObj(it) || typeof it.type !== 'string') {
        errors.push('Each item needs a string "type".');
        continue;
      }
      for (const k of Object.keys(it))
        if (k !== 'type' && k !== 'quantity') errors.push(`Unexpected item field "${k}".`);
      const q = it.quantity ?? 1;
      if (!Number.isInteger(q) || (q as number) < 1 || (q as number) > LIMITS.maxQuantity) {
        errors.push(`Quantity for "${it.type}" must be an integer 1–${LIMITS.maxQuantity}.`);
        continue;
      }
      const id = resolveFurniture(it.type);
      if (!id) {
        errors.push(`Unknown furniture "${it.type}".`);
        continue;
      }
      for (let k = 0; k < (q as number); k++) out.push(id);
    }
    if (out.length > LIMITS.maxItems) errors.push(`At most ${LIMITS.maxItems} items per request.`);
    return out;
  };

  const constraints = (): IntentConstraints | undefined => {
    if (v.constraints === undefined) return undefined;
    if (!isObj(v.constraints)) {
      errors.push('"constraints" must be an object.');
      return undefined;
    }
    const c = v.constraints;
    const out: IntentConstraints = {};
    const allowedKeys = ['minimumWalkway', 'doorClearance', 'keepDoorsClear', 'keepWindowsClear'];
    for (const k of Object.keys(c))
      if (!allowedKeys.includes(k)) errors.push(`Unexpected constraint "${k}".`);
    for (const k of ['minimumWalkway', 'doorClearance'] as const) {
      if (c[k] === undefined) continue;
      const n = c[k];
      const [lo, hi] = LIMITS.clearance;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi)
        errors.push(`${k} must be a number of metres between ${lo} and ${hi}.`);
      else out[k] = n;
    }
    for (const [k, target] of [
      ['keepDoorsClear', 'preserveDoorClearance'],
      ['keepWindowsClear', 'preserveWindowAccess'],
    ] as const) {
      if (c[k] === undefined) continue;
      if (typeof c[k] !== 'boolean') errors.push(`${k} must be true or false.`);
      else out[target] = c[k] as boolean;
    }
    return out;
  };

  let intent: Intent | undefined;
  switch (kind as AssistantIntentJson['intent']) {
    case 'fit_furniture': {
      const roomId = room();
      const furniture = items();
      const cons = constraints();
      const placement = v.placement;
      if (placement !== undefined && placement !== 'longest_wall' && placement !== 'any')
        errors.push('"placement" must be "longest_wall" or "any".');
      if (roomId && furniture.length) {
        intent = {
          action: 'place_furniture',
          roomId,
          furniture,
          ...(placement === 'longest_wall' || placement === 'any' ? { placement } : {}),
          ...(cons ? { constraints: cons } : {}),
        };
      }
      break;
    }
    case 'check_fit': {
      const roomId = room();
      const furniture = items();
      constraints();
      if (furniture.length > 1) errors.push('check_fit takes a single item.');
      if (roomId && furniture.length === 1)
        intent = { action: 'check_fit', roomId, furniture: furniture[0]! };
      break;
    }
    case 'renovate': {
      let roomIds: string[] = [];
      if (v.rooms === 'all') roomIds = ctx.rooms.filter((r) => r.type !== 'storage').map((r) => r.id);
      else if (Array.isArray(v.rooms)) {
        for (const r of v.rooms) {
          const id = typeof r === 'string' ? resolveRoom(r, ctx) : undefined;
          if (!id) errors.push(`Unknown room ${JSON.stringify(r)}.`);
          else roomIds.push(id);
        }
      } else if (v.rooms !== undefined) errors.push('"rooms" must be an array or "all".');
      else {
        const id = room();
        if (id) roomIds = [id];
      }
      const preset = parseStyle(v.style, errors);
      const patch = parseFinishes(v.finishes, errors);
      if (!preset && !patch) errors.push('renovate needs "style" or "finishes".');
      if (roomIds.length && (preset || patch)) {
        intent = { action: 'renovate', roomIds, ...(preset ? { preset } : {}), ...(patch ? { patch } : {}) };
      }
      break;
    }
    case 'remove_furniture': {
      const roomId = v.room === undefined ? undefined : room();
      const furniture = items();
      if (furniture.length)
        intent = { action: 'remove_furniture', furniture: furniture[0]!, ...(roomId ? { roomId } : {}) };
      break;
    }
    case 'describe_room': {
      const roomId = room();
      if (roomId) intent = { action: 'describe_room', roomId };
      break;
    }
  }
  if (errors.length || !intent) return { ok: false, errors: errors.length ? errors : ['Incomplete intent.'] };
  return { ok: true, intent };
}

function resolveRoom(ref: string, ctx: IntentContext): string | undefined {
  const exact = ctx.rooms.find((r) => r.id === ref || r.name.toLowerCase() === ref.trim().toLowerCase());
  if (exact) return exact.id;
  const match = matchRooms(ref.replace(/[-_]/g, ' '), ctx);
  return match?.ids.length === 1 ? match.ids[0] : undefined;
}

function resolveFurniture(type: string): string | undefined {
  if (getCatalogItem(type)) return type;
  const ids = matchFurniture(type.replace(/[-_]/g, ' '));
  return ids.length === 1 ? ids[0] : undefined;
}

function parseStyle(style: unknown, errors: string[]): string | undefined {
  if (style === undefined) return undefined;
  const preset =
    typeof style === 'string'
      ? RENOVATION_PRESETS.find((p) => p.id === style || p.name.toLowerCase() === style.toLowerCase())
      : undefined;
  if (!preset)
    errors.push(
      `Unknown style ${JSON.stringify(style)}. Allowed: ${RENOVATION_PRESETS.map((p) => p.id).join(', ')}.`,
    );
  return preset?.id;
}

function parseFinishes(f: unknown, errors: string[]): Partial<RoomRenovation> | undefined {
  if (f === undefined) return undefined;
  if (!isObj(f)) {
    errors.push('"finishes" must be an object.');
    return undefined;
  }
  const patch: Partial<RoomRenovation> = {};
  const material = (
    key: string,
    use: MaterialUse,
    field: 'floorMaterialId' | 'wallMaterialId' | 'ceilingMaterialId',
  ) => {
    const v = f[key];
    if (v === undefined) return;
    const ok =
      typeof v === 'string'
        ? materialsFor(use).find((m) => m.id === v || m.name.toLowerCase() === v.toLowerCase())
        : undefined;
    if (!ok) errors.push(`Unknown ${key} material ${JSON.stringify(v)}.`);
    else patch[field] = ok.id;
  };
  for (const k of Object.keys(f))
    if (!['floor', 'walls', 'wallColor', 'ceiling', 'lighting'].includes(k))
      errors.push(`Unexpected finish "${k}".`);
  material('floor', 'floor', 'floorMaterialId');
  material('walls', 'wall', 'wallMaterialId');
  material('ceiling', 'ceiling', 'ceilingMaterialId');
  if (f.wallColor !== undefined) {
    if (typeof f.wallColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(f.wallColor))
      errors.push('wallColor must be #rrggbb.');
    else patch.wallColor = f.wallColor.toLowerCase();
  }
  if (f.lighting !== undefined) {
    if (!['warm', 'neutral', 'cool', 'off'].includes(f.lighting as string))
      errors.push('lighting must be warm, neutral, cool or off.');
    else patch.lighting = f.lighting as LightingPreset;
  }
  return Object.keys(patch).length ? patch : undefined;
}

/** Text an LLM is given: the contract plus the current apartment and catalogs. */
export function buildAssistantPrompt(userText: string, ctx: IntentContext): string {
  return [
    `You control an apartment planner. Reply with JSON only (contract v${ASSISTANT_CONTRACT_VERSION}): one object or an array of up to ${LIMITS.maxIntents}.`,
    'Shape: {"intent": "fit_furniture"|"check_fit"|"renovate"|"remove_furniture"|"describe_room", "room"?: string, "rooms"?: string[]|"all", "items"?: [{"type": string, "quantity"?: 1-8}], "style"?: string, "finishes"?: {"floor"?, "walls"?, "wallColor"?, "ceiling"?, "lighting"?}, "placement"?: "longest_wall"|"any", "constraints"?: {"minimumWalkway"?: metres, "doorClearance"?: metres, "keepDoorsClear"?: boolean, "keepWindowsClear"?: boolean}}',
    'Never invent rooms, furniture or materials. Geometry is decided by the planner, not by you.',
    `Context: ${JSON.stringify(ctx)}`,
    `User: ${userText}`,
  ].join('\n');
}

/**
 * Intent provider backed by any text-completion function (e.g. a Claude API call made by a
 * backend). Transport is injected, so this module has no network or key handling.
 */
export class JsonIntentProvider implements IntentProvider {
  readonly name = 'llm-json';
  constructor(private readonly complete: (prompt: string) => Promise<string>) {}

  async parse(text: string, context: IntentContext): Promise<Intent[]> {
    const raw = await this.complete(buildAssistantPrompt(text, context));
    const res = parseAssistantJson(raw, context);
    return res.ok
      ? res.intents
      : [{ action: 'unknown', text, reason: `The assistant's answer was rejected: ${res.errors.join(' ')}` }];
  }
}
