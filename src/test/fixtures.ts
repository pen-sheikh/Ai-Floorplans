import { buildApartment } from '../floorplan';
import { E2_ANNOTATIONS } from '../floorplan/fixtures/e2/annotations';
import type { Apartment, Floor, Room } from '../domain/types';

/** The real E2 plan, built through the same generic pipeline the app uses. */
export const e2 = (): Apartment => buildApartment(E2_ANNOTATIONS).apartment;
export const e2Floor = (): Floor => e2().floors[0]!;

export const room = (floor: Floor, id: string): Room => {
  const r = floor.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`room ${id} missing`);
  return r;
};

let n = 0;
export const testId = (): string => `test-${++n}`;
