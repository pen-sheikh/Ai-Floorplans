import { getCatalogItem } from '../catalog/furnitureCatalog';
import { getRenovationPreset, presetPatchFor } from '../catalog/renovationPresets';
import { add } from '../domain/geometry';
import type { Apartment, Dimensions3, Floor, FurnitureItem, RoomRenovation, Vec2 } from '../domain/types';
import type { PlacementConstraints } from '../engine/constraints';
import { fitFurniture, type FitPlacement, type FitRequest } from '../engine/fitting';
import { checkPlacement, type PlacementReport } from '../engine/placement';
import type { Command, FurniturePatch } from './commands';

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
      return {
        command: { type: 'furniture/add', item: { ...copy, roomId: report.roomId } },
        result: { request: { catalogId: item.catalogId }, ok: true, item: copy, issues: report.issues },
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

/** Apply a renovation preset to one room, or every room on the floor. */
export function planPreset(apt: Apartment, presetId: string, roomIds: string[]): Command | null {
  const preset = getRenovationPreset(presetId);
  if (!preset) return null;
  const rooms = apt.floors.flatMap((f) => f.rooms).filter((r) => roomIds.includes(r.id));
  const commands: Command[] = rooms
    .map((r) => ({ room: r, patch: presetPatchFor(preset, r.type) }))
    .filter((x) => Object.keys(x.patch).length > 0)
    .map((x) => ({ type: 'room/renovate', roomId: x.room.id, patch: x.patch }));
  return commands.length ? { type: 'batch', label: `${preset.name} style`, commands } : null;
}

export function renovateCommand(roomId: string, patch: Partial<RoomRenovation>): Command {
  return { type: 'room/renovate', roomId, patch };
}
