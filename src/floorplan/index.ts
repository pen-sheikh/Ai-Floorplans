/**
 * Generic floor-plan pipeline. Nothing in this module (or below it) depends on a specific
 * plan; reference plans live in `fixtures/` and are registered in `src/config/plans.ts`.
 */
export * from './annotationTypes';
export {
  calibrateAnnotations,
  calibrateFromReferences,
  calibrationReferences,
  CalibrationError,
  manualCalibration,
} from './calibrate';
export { reconstructApartment, ReconstructionError, type ReconstructOptions } from './reconstruct';
export { validateAnnotations, type AnnotationIssue } from './validateAnnotations';
export * from './extraction';
