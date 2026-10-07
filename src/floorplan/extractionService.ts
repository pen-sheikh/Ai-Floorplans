import { parseAnnotationsJson } from './annotationSchema';
import { calibrateAnnotations } from './calibrate';
import {
  calibrationReport,
  extractFromImage,
  summariseConfidence,
  type CvExtractionOptions,
} from './cv/extractor';
import type { RgbaImage } from './cv/raster';
import { assessExtraction } from './cv/review';
import type { OcrProvider } from './cv/text';
import type { ExtractionResult, ExtractionStageName, FloorPlanSource } from './extraction';

/**
 * The boundary the UI talks to: "here is a plan image, give me annotations". Two
 * implementations, same contract:
 *
 *  - LocalExtractionService: the computer-vision extractor and OCR run in the browser,
 *    offline. Nothing leaves the device. (The default.)
 *  - RemoteExtractionService: posts the image to a server endpoint of OUR OWN deployment,
 *    which may call a hosted vision model with credentials kept server-side. The browser
 *    never holds API keys. Whatever comes back is untrusted: it must parse as
 *    FloorPlanAnnotations (annotationSchema.ts), and calibration, confidence and review are
 *    recomputed here — a server cannot declare its own output "ok".
 */
export interface ExtractionRequest {
  image: RgbaImage;
  source: FloorPlanSource;
  /** The original file, for services that upload it. */
  file?: Blob;
  /** Corrections from the user: a known measurement, or a typed-in scale. */
  reference?: CvExtractionOptions['reference'];
  pixelsPerMeter?: number;
}

export type ProgressFn = (stage: ExtractionStageName, message: string) => void;

export interface FloorPlanExtractionService {
  readonly name: string;
  /** True when no data leaves the device. */
  readonly local: boolean;
  extract(request: ExtractionRequest, onProgress?: ProgressFn): Promise<ExtractionResult>;
}

export class LocalExtractionService implements FloorPlanExtractionService {
  readonly name = 'local computer vision';
  readonly local = true;
  constructor(private readonly ocr: () => OcrProvider | null) {}

  extract(req: ExtractionRequest, onProgress?: ProgressFn): Promise<ExtractionResult> {
    return extractFromImage(req.image, req.source, {
      ocr: this.ocr(),
      ...(req.reference ? { reference: req.reference } : {}),
      ...(req.pixelsPerMeter ? { pixelsPerMeter: req.pixelsPerMeter } : {}),
      ...(onProgress ? { onProgress } : {}),
    });
  }
}

export class ExtractionServiceError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Response contract of a remote extraction endpoint (JSON):
 *   { "annotations": FloorPlanAnnotations, "warnings"?: string[] }
 * Any other top-level field is ignored; malformed annotations are rejected, not repaired.
 */
export function resultFromRemoteJson(json: unknown, source: FloorPlanSource): ExtractionResult {
  if (typeof json !== 'object' || json === null || !('annotations' in json))
    throw new ExtractionServiceError('The extraction service returned no annotations.');
  const body = json as { annotations: unknown; warnings?: unknown };
  const parsed = parseAnnotationsJson(body.annotations);
  if (!parsed.ok)
    throw new ExtractionServiceError(
      'The extraction service returned annotations that do not match the schema.',
      parsed.errors,
    );
  const annotations = {
    ...parsed.annotations,
    source: { ...parsed.annotations.source, method: 'automatic' as const },
  };
  const warnings = Array.isArray(body.warnings)
    ? body.warnings.filter((w): w is string => typeof w === 'string').slice(0, 50)
    : [];
  if (annotations.image.widthPx !== source.widthPx || annotations.image.heightPx !== source.heightPx) {
    if (source.widthPx && source.heightPx)
      throw new ExtractionServiceError(
        'The annotations refer to an image of a different size than the one sent.',
      );
  }
  let calibration;
  try {
    calibration = calibrationReport(calibrateAnnotations(annotations));
  } catch (e) {
    throw new ExtractionServiceError(
      `The annotations cannot be calibrated: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const confidence = summariseConfidence(annotations, calibration);
  return {
    annotations,
    stages: [
      {
        stage: 'annotations',
        status: 'ok',
        message: `Received from ${annotations.source.producer ?? 'remote service'}`,
      },
    ],
    warnings,
    confidence,
    calibration,
    review: assessExtraction(annotations, calibration, { warnings }),
  };
}

export class RemoteExtractionService implements FloorPlanExtractionService {
  readonly name = 'remote extraction service';
  readonly local = false;
  constructor(
    /** Same-origin endpoint of this deployment, e.g. "/api/extract-floorplan". */
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async extract(req: ExtractionRequest, onProgress?: ProgressFn): Promise<ExtractionResult> {
    if (!req.file) throw new ExtractionServiceError('The remote service needs the original image file.');
    onProgress?.('annotations', 'Sending the plan to the extraction service…');
    const form = new FormData();
    form.set('image', req.file, req.source.file);
    form.set(
      'request',
      JSON.stringify({ source: req.source, reference: req.reference, pixelsPerMeter: req.pixelsPerMeter }),
    );
    // No credentials or keys from the browser: the server authenticates to any model provider.
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    });
    if (!res.ok) throw new ExtractionServiceError(`The extraction service failed (HTTP ${res.status}).`);
    onProgress?.('annotations', 'Checking the returned annotations…');
    return resultFromRemoteJson(await res.json(), req.source);
  }
}
