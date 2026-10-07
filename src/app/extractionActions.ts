import { registerPlanImage } from '../assets/planImages';
import { APP_VALIDATION, registerExtractedPlan } from '../config/plans';
import { buildApartment, type FloorPlanAnnotations, type FloorPlanSource } from '../floorplan';
import { decodeImageBlob } from '../floorplan/cv/loadImage.browser';
import { browserOcrProvider } from '../floorplan/cv/ocrBrowser';
import type { OcrProvider } from '../floorplan/cv/text';
import {
  ExtractionServiceError,
  LocalExtractionService,
  type ExtractionRequest,
  type FloorPlanExtractionService,
} from '../floorplan/extractionService';
import { useDocument } from '../state/documentStore';
import { useExtraction } from '../state/extractionStore';
import { useScene } from '../state/sceneStore';
import { useUi } from '../state/uiStore';

/**
 * Upload → extract → review → accept. Extraction runs on this device (computer vision plus
 * offline OCR); the result is only turned into the 3D model when the user accepts it, and
 * never when the review says it failed.
 */
let ocr: OcrProvider | null = null;
const service: FloorPlanExtractionService = new LocalExtractionService(() => (ocr ??= browserOcrProvider()));

const MIME: Record<string, FloorPlanSource['mimeType']> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
};

export async function startExtraction(file: File): Promise<void> {
  const st = useExtraction.getState();
  st.reset();
  const mimeType = MIME[file.type];
  if (!mimeType) {
    useExtraction.getState().set({
      open: true,
      phase: 'error',
      fileName: file.name,
      error:
        'Please choose a PNG, JPEG or WebP image of a floor plan. (PDFs: export the page as an image first.)',
    });
    return;
  }
  useExtraction.getState().set({
    open: true,
    phase: 'running',
    fileName: file.name,
    file,
    progress: [{ stage: 'decode', message: 'Reading the image…' }],
  });
  try {
    const { image, url, scaled } = await decodeImageBlob(file);
    const sourceId = `upload-${Date.now().toString(36)}`;
    useExtraction.getState().set({ image, imageUrl: url, sourceId });
    if (scaled)
      progress('decode', `Large image reduced to ${image.width} × ${image.height} px for processing.`);
    await run({
      image,
      source: {
        id: sourceId,
        file: `uploads/${sourceId}/${file.name}`,
        mimeType,
        widthPx: image.width,
        heightPx: image.height,
      },
      file,
    });
  } catch (e) {
    fail(e);
  }
}

/** Correction: re-run with a known measurement (top calibration priority). */
export async function rerunWithReference(
  reference: NonNullable<ExtractionRequest['reference']>,
): Promise<void> {
  const { image, file, sourceId, fileName } = useExtraction.getState();
  if (!image || !sourceId || !fileName) return;
  useExtraction
    .getState()
    .set({ phase: 'running', progress: [], result: undefined, highlight: [], acknowledged: false });
  try {
    await run({
      image,
      source: {
        id: sourceId,
        file: `uploads/${sourceId}/${fileName}`,
        mimeType: MIME[file?.type ?? ''] ?? 'image/png',
        widthPx: image.width,
        heightPx: image.height,
      },
      ...(file ? { file } : {}),
      reference,
    });
  } catch (e) {
    fail(e);
  }
}

async function run(req: ExtractionRequest): Promise<void> {
  const result = await service.extract(req, (stage, message) => progress(stage, message));
  useExtraction.getState().set({ phase: 'done', result });
}

function progress(stage: string, message: string): void {
  useExtraction.getState().set({ progress: [...useExtraction.getState().progress, { stage, message }] });
}

function fail(e: unknown): void {
  useExtraction.getState().set({
    phase: 'error',
    error: e instanceof Error ? e.message : String(e),
    errorDetails: e instanceof ExtractionServiceError ? e.details : [],
  });
}

/** Accept the reviewed extraction: build the apartment through the normal pipeline. */
export function acceptExtraction(): void {
  const { result, imageUrl, fileName, acknowledged } = useExtraction.getState();
  if (!result || !imageUrl) return;
  const status = result.review?.status ?? 'needs-review';
  if (status === 'failed') return; // the UI disables Accept; never build from a failed extraction
  if (status === 'needs-review' && !acknowledged) return;
  const flagged = (result.review?.problems ?? []).filter((p) => p.severity !== 'info');
  const annotations: FloorPlanAnnotations = {
    ...result.annotations,
    name: `${(fileName ?? 'Plan').replace(/\.[a-z]+$/i, '')} (extracted)`,
    // Keep what the review flagged with the model, so it stays visible after accepting.
    drawingNotes: [
      ...result.annotations.drawingNotes,
      ...flagged.map((p, i) => ({ id: `review-${i + 1}`, message: `Extraction review: ${p.message}` })),
    ],
  };
  try {
    const { apartment } = buildApartment(annotations, {}, APP_VALIDATION);
    registerPlanImage(annotations.image.file, imageUrl);
    registerExtractedPlan(annotations);
    useDocument.getState().load(apartment);
    useScene.getState().select(null);
    useExtraction.getState().set({ open: false });
    useUi.getState().setLeftTab('model');
    useUi
      .getState()
      .toast(
        flagged.length ? 'warning' : 'success',
        flagged.length
          ? `Model built from ${fileName}. ${flagged.length} item(s) were flagged — see the Model tab.`
          : `Model built from ${fileName}.`,
      );
  } catch (e) {
    fail(e);
  }
}

export function closeExtraction(): void {
  const { imageUrl, open, sourceId, fileName } = useExtraction.getState();
  if (!open) return;
  // Keep the object URL alive only if the current model uses this upload.
  const used = useDocument.getState().apartment.coordinateSystem.plan?.image.file;
  if (imageUrl && used !== `uploads/${sourceId}/${fileName}`) URL.revokeObjectURL(imageUrl);
  useExtraction.getState().reset();
}
