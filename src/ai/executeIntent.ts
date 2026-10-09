import { getCatalogItem } from '../catalog/furnitureCatalog';
import { getMaterialDef } from '../catalog/materials';
import { getRenovationPreset } from '../catalog/renovationPresets';
import { pointSegmentDistance, polygonEdges, rotateY, add, scale } from '../domain/geometry';
import { roomMetrics } from '../domain/topology';
import type { Apartment, FurnitureItem, Room } from '../domain/types';
import { formatArea, formatLength } from '../domain/units';
import type { Command } from '../editor/commands';
import { planFitMany, planPreset, renovationCommands } from '../editor/operations';
import type { PlacementConstraints } from '../engine/constraints';
import { explainFit, fitFurniture } from '../engine/fitting';
import { buildIntentContext, validateIntent, type Intent, type IntentConstraints } from './intents';

export interface IntentExecution {
  /** Command to dispatch (absent for questions or failures). */
  command?: Command;
  reply: string;
  /** A follow-up the user can accept with one click. */
  suggestion?: { label: string; command: Command };
  ok: boolean;
}

export interface ExecutionContext {
  apartment: Apartment;
  constraints: PlacementConstraints;
  newId: () => string;
}

/** Apply an intent's (already validated) rule changes on top of the user's constraints. */
export function constraintsFor(
  base: PlacementConstraints,
  ic: IntentConstraints | undefined,
): PlacementConstraints {
  if (!ic) return base;
  const requireClear = new Set(base.requireClear ?? []);
  if (ic.preserveDoorClearance) requireClear.add('door-clearance');
  if (ic.preserveWindowAccess) requireClear.add('window-blocked');
  return {
    ...base,
    ...(ic.minimumWalkway !== undefined ? { walkingClearance: ic.minimumWalkway } : {}),
    ...(ic.doorClearance !== undefined ? { doorClearance: ic.doorClearance } : {}),
    requireClear: [...requireClear],
  };
}

const roomById = (apt: Apartment, id: string): Room | undefined =>
  apt.floors[0]!.rooms.find((r) => r.id === id);

/** "against the 6.39 m wall" for wall-placed items. */
function describeSpot(item: FurnitureItem, room: Room): string {
  const cat = getCatalogItem(item.catalogId);
  if (!cat?.placement.againstWall) return 'near the middle of the room';
  const back = add(item.position, scale(rotateY({ x: 0, z: -1 }, item.rotation), item.dimensions.depth / 2));
  const edge = polygonEdges(room.polygon).reduce((best, e) =>
    pointSegmentDistance(back, e.a, e.b) < pointSegmentDistance(back, best.a, best.b) ? e : best,
  );
  return `against the ${formatLength(edge.length)} wall`;
}

/**
 * Execute a structured intent with deterministic code. The model's output is validated
 * first; geometry decisions are made by the fitting/placement engine, never by the model.
 */
export function executeIntent(intent: Intent, ctx: ExecutionContext): IntentExecution {
  const errors = validateIntent(intent, buildIntentContext(ctx.apartment));
  if (errors.length) return { ok: false, reply: errors.join(' ') };
  const floor = ctx.apartment.floors[0]!;

  switch (intent.action) {
    case 'place_furniture': {
      const room = roomById(ctx.apartment, intent.roomId)!;
      const requests = intent.furniture.map((catalogId) => ({
        catalogId,
        ...(intent.placement === 'longest_wall' ? { preferWall: 'longest' as const } : {}),
      }));
      const { command, result } = planFitMany(
        floor,
        room.id,
        requests,
        constraintsFor(ctx.constraints, intent.constraints),
        ctx.newId,
        `Furnish ${room.name}`,
      );
      const lines = result.map((p) => {
        const name = getCatalogItem(p.request.catalogId)?.name ?? p.request.catalogId;
        if (!p.ok || !p.item) return `✗ ${explainFit(p, name, room.name)}`;
        const soft = p.issues.length ? ` (note: ${p.issues.map((i) => i.message).join(' ')})` : '';
        return `✓ ${name} ${describeSpot(p.item, room)}${soft}`;
      });
      const placed = result.filter((p) => p.ok).length;
      return {
        ok: placed > 0,
        ...(command ? { command } : {}),
        reply: `${placed}/${result.length} placed in ${room.name}.\n${lines.join('\n')}`,
      };
    }

    case 'check_fit': {
      const room = roomById(ctx.apartment, intent.roomId)!;
      const cat = getCatalogItem(intent.furniture)!;
      const { placements } = fitFurniture(
        floor,
        room.id,
        [{ catalogId: cat.id }],
        ctx.constraints,
        ctx.newId,
      );
      const p = placements[0]!;
      const size = `${cat.dimensions.width.toFixed(2)} × ${cat.dimensions.depth.toFixed(2)} m`;
      if (!p.ok || !p.item) {
        return {
          ok: true,
          reply: `No — a ${cat.name.toLowerCase()} (${size}) does not fit in ${room.name}.
${explainFit(p, cat.name, room.name)}`,
        };
      }
      const caveat = p.issues.length
        ? ` It fits, but: ${p.issues.map((i) => i.message).join(' ')}`
        : ' It keeps door swings and walkways clear.';
      return {
        ok: true,
        reply: `Yes — a ${cat.name.toLowerCase()} (${size}) fits in ${room.name} ${describeSpot(p.item, room)}.${caveat}`,
        suggestion: {
          label: `Add ${cat.name.toLowerCase()}`,
          command: { type: 'furniture/add', item: p.item },
        },
      };
    }

    case 'renovate': {
      const names = intent.roomIds.map((id) => roomById(ctx.apartment, id)!.name);
      const commands: Command[] = [];
      if (intent.preset) {
        const c = planPreset(ctx.apartment, intent.preset, intent.roomIds);
        if (c) commands.push(c);
      }
      if (intent.patch && Object.keys(intent.patch).length) {
        for (const roomId of intent.roomIds)
          commands.push(...renovationCommands(ctx.apartment, roomId, intent.patch));
      }
      if (!commands.length)
        return { ok: false, reply: 'That style does not change anything in these rooms.' };
      const changes = [
        intent.preset ? `${getRenovationPreset(intent.preset)!.name} style` : null,
        ...Object.entries(intent.patch ?? {}).map(([k, v]) =>
          k.endsWith('MaterialId')
            ? `${k.replace('MaterialId', '')}: ${getMaterialDef(String(v))?.name ?? v}`
            : `${k}: ${String(v)}`,
        ),
      ].filter(Boolean);
      return {
        ok: true,
        command: commands.length === 1 ? commands[0]! : { type: 'batch', label: 'Renovate', commands },
        reply: `Updated ${names.join(', ')} — ${changes.join(', ')}.`,
      };
    }

    case 'remove_furniture': {
      const cat = getCatalogItem(intent.furniture);
      const matches = floor.furniture.filter(
        (f) =>
          (f.catalogId === intent.furniture || (cat && f.category === cat.category)) &&
          (!intent.roomId || f.roomId === intent.roomId),
      );
      if (!matches.length)
        return { ok: false, reply: `There is no ${cat?.name.toLowerCase() ?? intent.furniture} to remove.` };
      return {
        ok: true,
        command: {
          type: 'batch',
          label: 'Remove furniture',
          commands: matches.map((f) => ({ type: 'furniture/remove', id: f.id })),
        },
        reply: `Removed ${matches.length} × ${matches[0]!.name.toLowerCase()}.`,
      };
    }

    case 'describe_room': {
      const room = roomById(ctx.apartment, intent.roomId)!;
      const m = roomMetrics(room);
      const items = floor.furniture.filter((f) => f.roomId === room.id).map((f) => f.name);
      return {
        ok: true,
        reply: `${room.name}: ${formatArea(m.area)}, ${formatLength(m.width)} × ${formatLength(m.depth)} (extents), ${room.doorIds.length} door(s)/opening(s), ${room.windowIds.length} window(s). Furniture: ${items.length ? items.join(', ') : 'none'}.`,
      };
    }

    case 'unknown':
      return { ok: false, reply: intent.reason };
  }
}

/** Public name for the assistant boundary: structured intent → deterministic execution. */
export const executeAssistantIntent = executeIntent;
