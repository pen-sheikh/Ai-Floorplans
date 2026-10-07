import { loadApartmentFromPlan } from '../floorplan';
import type { Apartment, Floor, Room } from '../domain/types';

/** The real E2 plan, reconstructed. Tests use the same pipeline as the app. */
export const e2 = (): Apartment => loadApartmentFromPlan();
export const e2Floor = (): Floor => e2().floors[0]!;

export const room = (floor: Floor, id: string): Room => {
  const r = floor.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`room ${id} missing`);
  return r;
};

let n = 0;
export const testId = (): string => `test-${++n}`;
