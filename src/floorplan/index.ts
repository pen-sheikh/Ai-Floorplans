import type { Apartment } from '../domain/types';
import { PACKENHAM_HOUSE_E2 } from './annotations/packenhamHouseE2';
import type { FloorPlanAnnotation } from './annotationTypes';
import { reconstructApartment, type ReconstructOptions } from './reconstruct';

/** Plans available in this repository. A future upload/extraction step would add to this. */
export const PLAN_ANNOTATIONS: Record<string, FloorPlanAnnotation> = {
  [PACKENHAM_HOUSE_E2.id]: PACKENHAM_HOUSE_E2,
};

export const DEFAULT_PLAN_ID = PACKENHAM_HOUSE_E2.id;

export function loadApartmentFromPlan(
  planId: string = DEFAULT_PLAN_ID,
  options?: ReconstructOptions,
): Apartment {
  const ann = PLAN_ANNOTATIONS[planId];
  if (!ann) throw new Error(`Unknown plan ${planId}`);
  return reconstructApartment(ann, options);
}

export { reconstructApartment } from './reconstruct';
export type { FloorPlanAnnotation } from './annotationTypes';
