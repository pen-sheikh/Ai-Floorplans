import { getCatalogItem } from '../catalog/furnitureCatalog';
import { getRenovationPreset, presetPatchFor } from '../catalog/renovationPresets';
import { add } from '../domain/geometry';
import type { Apartment, Dimensions3, Floor, FurnitureItem, RoomRenovation, Vec2 } from '../domain/types';
import type { PlacementConstraints } from '../engine/constraints';
import { fitFurniture, type FitPlacement, type FitRequest } from '../engine/fitting';
import { checkPlacement, type PlacementReport } from '../engine/placement';
import { validateApartment, type ValidationContext } from '../domain/validation';
import { applyCommand, CommandError, type Command, type FurniturePatch } from './commands';

/**
 * Editing operations that need spatial reasoning. They are pure: given the current model and
 * constraints they return the command to dispatch (if the edit is allowed) and a report
 * explaining the decision. UI handlers and AI intents both go through these.
 */

export interface PlannedEdit<R> {
  command?: Command;
  result: R;
}

export function planAddFurniture(
  floor: Floor,
  roomId: string,
  request: FitRequest,
  constraints: PlacementConstraints,
  newId: () => string,
): PlannedEdit<FitPlacement> {
  const { placements } = fitFurniture(floor, roomId, [request], constraints, newId);
  const result = placements[0]!;
  return result.ok && result.item
    ? { command: { type: 'furniture/add', item: result.item }, result }
    : { result };
}

export function planFitMany(
  floor: Floor,
  roomId: string,
  requests: FitRequest[],
  constraints: PlacementConstraints,
  newId: () => string,
  label: string,
): PlannedEdit<FitPlacement[]> {
  const { placements } = fitFurniture(floor, roomId, requests, constraints, newId);
  const commands: Command[] = placements.flatMap((p) =>
    p.ok && p.item ? [{ type: 'furniture/add', item: p.item } as const] : [],
  );
  return commands.length
    ? { command: { type: 'batch', label, commands }, result: placements }
    : { result: placements };
}

export interface TransformRequest {
  position?: Vec2;
  rotation?: number;
  dimensions?: Dimensions3;
}

/**
 * Move/rotate/resize with constraint enforcement. Edits that trigger a blocking issue
 * (by default: leaving the room, hitting a wall or fixture) produce no command.
 */
export function planTransform(
  floor: Floor,
  itemId: string,
  req: TransformRequest,
  constraints: PlacementConstraints,
): PlannedEdit<PlacementReport | null> {
  const item = floor.furniture.find((f) => f.id === itemId);
  if (!item) return { result: null };
  const cat = getCatalogItem(item.catalogId);
  let dimensions = req.dimensions;
  if (dimensions && cat) {
    const clamp = (v: number, k: keyof Dimensions3) =>
      Math.min(cat.resize.max[k], Math.max(cat.resize.min[k], v));
    dimensions = {
      width: clamp(dimensions.width, 'width'),
      depth: clamp(dimensions.depth, 'depth'),
      height: clamp(dimensions.height, 'height'),
    };
  }
  const next = {
    ...item,
    ...(req.position ? { position: req.position } : {}),
    ...(req.rotation !== undefined ? { rotation: req.rotation } : {}),
    ...(dimensions ? { dimensions } : {}),
  };
  const report = checkPlacement(floor, next, constraints);
  if (report.blocked) return { result: report };
  const patch: FurniturePatch = {
    ...(req.position ? { position: req.position } : {}),
    ...(req.rotation !== undefined ? { rotation: req.rotation } : {}),
    ...(dimensions ? { dimensions } : {}),
    ...(report.roomId && report.roomId !== item.roomId ? { roomId: report.roomId } : {}),
  };
  return { command: { type: 'furniture/update', id: itemId, patch }, result: report };
}

/** Duplicate next to the original if possible, otherwise wherever the fitting engine finds room. */
export function planDuplicate(
  floor: Floor,
  itemId: string,
  constraints: PlacementConstraints,
  newId: () => string,
): PlannedEdit<FitPlacement | null> {
  const item = floor.furniture.find((f) => f.id === itemId);
  if (!item) return { result: null };
  const offsets: Vec2[] = [
    { x: item.dimensions.width + 0.1, z: 0 },
    { x: -(item.dimensions.width + 0.1), z: 0 },
    { x: 0, z: item.dimensions.depth + 0.1 },
    { x: 0, z: -(item.dimensions.depth + 0.1) },
  ];
  for (const o of offsets) {
    const copy: FurnitureItem = { ...item, id: newId(), position: add(item.position, o) };
    const report = checkPlacement(floor, copy, constraints);
    if (!report.hard && report.roomId) {
      const placed = { ...copy, roomId: report.roomId };
      return {
        command: { type: 'furniture/add', item: placed },
        result: {
          request: { catalogId: item.catalogId },
          ok: true,
          item: placed,
          issues: report.issues,
          candidatesTried: 1,
        },
      };
    }
  }
  return planAddFurniture(
    floor,
    item.roomId,
    {
      catalogId: item.catalogId,
      dimensions: item.dimensions,
      materialId: item.materialId,
      ...(item.color ? { color: item.color } : {}),
    },
    constraints,
    newId,
  );
}

/**
 * Everything one room renovation changes. Door and window finishes are rendered from the doors
 * and windows themselves (`Door.materialId`, `Window.materialId`), so a patch that sets
 * `doorMaterialId` / `windowMaterialId` also updates every door/window of the room — including
 * a door shared with a neighbouring room. A patch without them leaves doors and windows alone.
 * The room panel, style presets and the assistant all go through this, so they cannot drift.
 */
export function renovationCommands(
  apt: Apartment,
  roomId: string,
  patch: Partial<RoomRenovation>,
): Command[] {
  const room = apt.floors.flatMap((f) => f.rooms).find((r) => r.id === roomId);
  if (!room) return [];
  const commands: Command[] = [{ type: 'room/renovate', roomId, patch }];
  const { doorMaterialId, windowMaterialId } = patch;
  if (doorMaterialId) {
    for (const id of room.doorIds)
      commands.push({ type: 'door/update', id, patch: { materialId: doorMaterialId } });
  }
  if (windowMaterialId) {
    for (const id of room.windowIds)
      commands.push({ type: 'window/update', id, patch: { materialId: windowMaterialId } });
  }
  return commands;
}

/**
 * Apply a renovation preset to one room, or every room on the floor. Rooms are processed in the
 * order given; a door shared by two of them takes the finish of the later one.
 */
export function planPreset(apt: Apartment, presetId: string, roomIds: string[]): Command | null {
  const preset = getRenovationPreset(presetId);
  if (!preset) return null;
  const rooms = roomIds
    .map((id) => apt.floors.flatMap((f) => f.rooms).find((r) => r.id === id))
    .filter((r) => r !== undefined);
  const commands: Command[] = rooms
    .map((r) => ({ room: r, patch: presetPatchFor(preset, r.type) }))
    .filter((x) => Object.keys(x.patch).length > 0)
    .flatMap((x) => renovationCommands(apt, x.room.id, x.patch));
  return commands.length ? { type: 'batch', label: `${preset.name} style`, commands } : null;
}

export function renovateCommand(roomId: string, patch: Partial<RoomRenovation>): Command {
  return { type: 'room/renovate', roomId, patch };
}

export interface WallMoveReport {
  ok: boolean;
  /** Why the move was refused (geometry the edit cannot keep consistent, or a validation error). */
  reason?: string;
  /** New validation warnings the move would introduce (e.g. furniture now outside its room). */
  warnings: string[];
}

/**
 * Plan moving an interior wall `distance` metres along its normal. The edit is applied to a copy
 * and the whole model is validated: it is only allowed when it introduces no validation error.
 * New warnings are reported, not hidden.
 */
export function planWallMove(
  apt: Apartment,
  wallId: string,
  distance: number,
  ctx: ValidationContext = {},
): PlannedEdit<WallMoveReport> {
  const command: Command = { type: 'wall/move', id: wallId, distance };
  let next: Apartment;
  try {
    next = applyCommand(apt, command);
  } catch (e) {
    if (e instanceof CommandError) return { result: { ok: false, reason: e.message, warnings: [] } };
    throw e;
  }
  const before = validateApartment(apt, ctx).issues;
  const after = validateApartment(next, ctx).issues;
  const key = (i: { code: string; entity?: { id: string } }) => `${i.code}|${i.entity?.id ?? ''}`;
  const known = new Set(before.map(key));
  const added = after.filter((i) => !known.has(key(i)));
  const error = added.find((i) => i.severity === 'error');
  if (error) return { result: { ok: false, reason: error.message, warnings: [] } };
  return {
    command,
    result: { ok: true, warnings: added.filter((i) => i.severity === 'warning').map((i) => i.message) },
  };
}
