import type { Floor } from '../domain/types';
import type { PlacementConstraints } from './constraints';
import { checkPlacement } from './placement';

const cache = new WeakMap<Floor, WeakMap<PlacementConstraints, Set<string>>>();

/**
 * Ids of furniture items that currently break a hard rule. Memoised per (floor, constraints)
 * object, so the 2D plan, the 3D scene and the inspector share one computation per edit.
 */
export function furnitureConflicts(floor: Floor, c: PlacementConstraints): Set<string> {
  let byConstraints = cache.get(floor);
  if (!byConstraints) cache.set(floor, (byConstraints = new WeakMap()));
  let ids = byConstraints.get(c);
  if (!ids) {
    ids = new Set(floor.furniture.filter((f) => checkPlacement(floor, f, c).hard).map((f) => f.id));
    byConstraints.set(c, ids);
  }
  return ids;
}
