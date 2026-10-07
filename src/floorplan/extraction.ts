import type { Apartment } from '../domain/types';
import { validateApartment, type ValidationContext, type ValidationIssue } from '../domain/validation';
import type { FloorPlanAnnotations } from './annotationTypes';
import { reconstructApartment, ReconstructionError, type ReconstructOptions } from './reconstruct';
import { validateAnnotations, type AnnotationIssue } from './validateAnnotations';

/**
 * Boundary for floor-plan extraction. Implementations:
 *  - StaticAnnotationExtractor: hand-made / previously reviewed annotations (e.g. the E2 fixture)
 *  - ComputerVisionExtractor (cv/extractor.ts): local image analysis + optional offline OCR
 *  - RemoteExtractionService: a server endpoint (vision models, hosted OCR) — keys stay server-side
 *
 *   uploaded JPG/PNG/PDF → preprocessing → walls → openings → rooms → text/labels →
 *   dimensions → calibration → FloorPlanAnnotations → reconstruction → Apartment
 *
 * An extractor only has to produce `FloorPlanAnnotations`. Everything after that —
 * validation, calibration, reconstruction, topology, model validation — is shared with
 * hand-made annotations such as the E2 reference fixture.
 */

/** The raw input a user uploads. */
export interface FloorPlanSource {
  id: string;
  /** Bundled path or URL of the image (PDF pages are rasterised before extraction). */
  file: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  widthPx?: number;
  heightPx?: number;
  /** Page index for multi-page PDFs. */
  page?: number;
}

export type ExtractionStageName =
  'preprocess' | 'walls' | 'openings' | 'rooms' | 'text' | 'dimensions' | 'calibration' | 'annotations';

export interface ExtractionStageReport {
  stage: ExtractionStageName;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  confidence?: number;
  message?: string;
  /** Wall-clock time of the stage. */
  ms?: number;
}

/** Mean confidence per category, and a weighted overall score, in [0, 1]. */
export interface ExtractionConfidence {
  walls: number;
  doors: number;
  windows: number;
  rooms: number;
  calibration: number;
  overall: number;
}

export interface ExtractionCalibrationReport {
  strategy: 'reference' | 'dimension-labels' | 'manual' | 'estimated';
  pixelsPerMeter: number;
  confidence: 'high' | 'medium' | 'low';
  basis?: string;
  samplesUsed: number;
  samplesRejected: number;
}

export interface ReviewProblem {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  elementId?: string;
  elementIds?: string[];
}

/** failed: cannot be reconstructed; needs-review: usable only after a person checks it. */
export interface ExtractionReview {
  status: 'ok' | 'needs-review' | 'failed';
  problems: ReviewProblem[];
}

export interface ExtractionResult {
  annotations: FloorPlanAnnotations;
  stages: ExtractionStageReport[];
  warnings: string[];
  errors?: string[];
  confidence?: ExtractionConfidence;
  calibration?: ExtractionCalibrationReport;
  review?: ExtractionReview;
}

export interface FloorPlanExtractor {
  readonly name: string;
  extract(source: FloorPlanSource): Promise<ExtractionResult>;
}

/** Serves known annotations (hand-made or cached extractor output) for known sources. */
export class StaticAnnotationExtractor implements FloorPlanExtractor {
  readonly name = 'static-annotations';
  constructor(private readonly bySourceId: Readonly<Record<string, FloorPlanAnnotations>>) {}

  async extract(source: FloorPlanSource): Promise<ExtractionResult> {
    const annotations = this.bySourceId[source.id];
    if (!annotations) throw new Error(`No annotations available for "${source.id}".`);
    return {
      annotations,
      stages: [
        {
          stage: 'annotations',
          status: 'ok',
          message: annotations.source.producer ?? annotations.source.method,
        },
      ],
      warnings: [],
    };
  }
}

export interface BuildResult {
  apartment: Apartment;
  annotationIssues: AnnotationIssue[];
  modelIssues: ValidationIssue[];
}

/**
 * annotations → validated apartment. The same function runs for manual and automatic
 * annotations; it throws `ReconstructionError` if the annotations cannot be reconstructed.
 */
export function buildApartment(
  annotations: FloorPlanAnnotations,
  options: ReconstructOptions = {},
  validation: ValidationContext = {},
): BuildResult {
  const annotationIssues = validateAnnotations(annotations);
  const apartment = reconstructApartment(annotations, options);
  const { issues } = validateApartment(apartment, validation);
  return { apartment, annotationIssues, modelIssues: issues };
}

/** source → extractor → annotations → apartment. */
export async function buildApartmentFromSource(
  source: FloorPlanSource,
  extractor: FloorPlanExtractor,
  options: ReconstructOptions = {},
  validation: ValidationContext = {},
): Promise<BuildResult & { extraction: ExtractionResult }> {
  const extraction = await extractor.extract(source);
  try {
    return { ...buildApartment(extraction.annotations, options, validation), extraction };
  } catch (e) {
    if (e instanceof ReconstructionError) e.message = `${extractor.name}: ${e.message}`;
    throw e;
  }
}
