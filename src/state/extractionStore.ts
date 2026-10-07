import { create } from 'zustand';
import type { RgbaImage } from '../floorplan/cv/raster';
import type { ExtractionResult } from '../floorplan';

/** State of the "import a floor plan image" flow (one session at a time). */
export interface ExtractionState {
  open: boolean;
  phase: 'idle' | 'running' | 'done' | 'error';
  fileName?: string;
  file?: Blob;
  image?: RgbaImage;
  imageUrl?: string;
  /** Source id of the current upload (stable across re-runs with corrections). */
  sourceId?: string;
  progress: { stage: string; message: string }[];
  result?: ExtractionResult;
  error?: string;
  errorDetails?: string[];
  /** Element ids highlighted on the overlay (from a selected problem). */
  highlight: string[];
  /** The user confirmed they reviewed the flagged problems. */
  acknowledged: boolean;
  set: (patch: Partial<ExtractionState>) => void;
  reset: () => void;
}

const initial = { open: false, phase: 'idle' as const, progress: [], highlight: [], acknowledged: false };

export const useExtraction = create<ExtractionState>()((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () =>
    set({
      ...initial,
      fileName: undefined,
      file: undefined,
      image: undefined,
      imageUrl: undefined,
      sourceId: undefined,
      result: undefined,
      error: undefined,
      errorDetails: undefined,
    }),
}));
