import { hasMaterial } from '../catalog/materials';
import { getCatalogItem } from '../catalog/furnitureCatalog';
import type { Apartment } from '../domain/types';
import type { ValidationContext } from '../domain/validation';
import {
  buildApartment,
  StaticAnnotationExtractor,
  type FloorPlanAnnotations,
  type FloorPlanSource,
} from '../floorplan';
import { E2_ANNOTATIONS } from '../floorplan/fixtures/e2/annotations';

/**
 * Composition root for plans: which plans this deployment knows about and which one opens
 * by default. This is configuration — swapping the default plan or adding an uploaded plan
 * does not touch the pipeline, the engine or the UI.
 */
export const KNOWN_PLANS: Readonly<Record<string, FloorPlanAnnotations>> = {
  [E2_ANNOTATIONS.id]: E2_ANNOTATIONS,
};

export const DEFAULT_PLAN_ID = E2_ANNOTATIONS.id;

/** Plans extracted from uploaded images during this session (so "Rebuild" works for them). */
const extractedPlans = new Map<string, FloorPlanAnnotations>();

export function registerExtractedPlan(ann: FloorPlanAnnotations): void {
  extractedPlans.set(ann.id, ann);
}

const planAnnotations = (planId: string): FloorPlanAnnotations | undefined =>
  KNOWN_PLANS[planId] ?? extractedPlans.get(planId);

export const hasSourcePlan = (planId: string): boolean => planAnnotations(planId) !== undefined;

/** Lookups that let domain validation check references into the app's catalogs. */
export const APP_VALIDATION: ValidationContext = {
  hasMaterial,
  hasCatalogItem: (id) => getCatalogItem(id) !== undefined,
};

export const sourceFor = (planId: string): FloorPlanSource => {
  const ann = KNOWN_PLANS[planId];
  if (!ann) throw new Error(`Unknown plan ${planId}`);
  return {
    id: planId,
    file: ann.image.file,
    mimeType: 'image/jpeg',
    widthPx: ann.image.widthPx,
    heightPx: ann.image.heightPx,
  };
};

export const knownPlanExtractor = new StaticAnnotationExtractor(KNOWN_PLANS);

/** Synchronous load of a known plan through the generic pipeline (used at start-up). */
export function loadKnownPlan(planId: string = DEFAULT_PLAN_ID): Apartment {
  const ann = planAnnotations(planId);
  if (!ann) throw new Error(`Unknown plan ${planId}`);
  return buildApartment(ann, {}, APP_VALIDATION).apartment;
}
