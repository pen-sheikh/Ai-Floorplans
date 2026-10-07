import { create } from 'zustand';
import type { EntityRef } from '../domain/types';
import { DEFAULT_CONSTRAINTS, type PlacementConstraints } from '../engine/constraints';

export type ViewMode = '3d' | '2d' | 'split';
export type CameraMode = 'perspective' | 'top' | 'room' | 'exterior';
export type LightingMode = 'day' | 'night' | 'interior';
export type OverlayPosition = 'floor' | 'above';

export interface DebugFlags {
  roomBoundaries: boolean;
  wallCenterlines: boolean;
  wallBounds: boolean;
  doorSwings: boolean;
  windows: boolean;
  roomIds: boolean;
  dimensions: boolean;
  furnitureBounds: boolean;
  collisionZones: boolean;
}

/**
 * Scene state: how the model is being looked at. Nothing here is part of the saved project.
 */
export interface SceneState {
  viewMode: ViewMode;
  camera: {
    mode: CameraMode;
    /** Bumped to re-trigger the same mode (e.g. Reset twice). */ nonce: number;
    roomId?: string;
  };
  zoomRequest: { delta: number; nonce: number };
  selection: EntityRef | null;
  hover: EntityRef | null;
  showCeilings: boolean;
  showFurniture: boolean;
  showDimensions: boolean;
  overlay: { visible: boolean; opacity: number; position: OverlayPosition };
  lighting: LightingMode;
  debug: { enabled: boolean; flags: DebugFlags };
  constraints: PlacementConstraints;
  /** Doors toggled open/closed in the viewer (animation state only; missing = open). */
  openDoors: Record<string, boolean>;
  /** Furniture currently being dragged (suppresses camera controls). */
  dragging: string | null;

  setViewMode: (m: ViewMode) => void;
  setCamera: (mode: CameraMode, roomId?: string) => void;
  zoom: (delta: number) => void;
  select: (ref: EntityRef | null) => void;
  setHover: (ref: EntityRef | null) => void;
  toggleCeilings: () => void;
  setShowDimensions: (v: boolean) => void;
  setOverlay: (patch: Partial<SceneState['overlay']>) => void;
  setLighting: (m: LightingMode) => void;
  setDebugEnabled: (v: boolean) => void;
  setDebugFlag: (flag: keyof DebugFlags, v: boolean) => void;
  setConstraints: (patch: Partial<PlacementConstraints>) => void;
  toggleDoor: (id: string) => void;
  setDragging: (id: string | null) => void;
}

export const DEFAULT_DEBUG_FLAGS: DebugFlags = {
  roomBoundaries: true,
  wallCenterlines: true,
  wallBounds: true,
  doorSwings: true,
  windows: true,
  roomIds: true,
  dimensions: false,
  furnitureBounds: true,
  collisionZones: false,
};

export const sameRef = (a: EntityRef | null, b: EntityRef | null): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

export const useScene = create<SceneState>()((set) => ({
  viewMode: 'split',
  camera: { mode: 'perspective', nonce: 0 },
  zoomRequest: { delta: 0, nonce: 0 },
  selection: null,
  hover: null,
  showCeilings: true,
  showFurniture: true,
  showDimensions: false,
  overlay: { visible: false, opacity: 0.6, position: 'floor' },
  lighting: 'day',
  debug: { enabled: false, flags: DEFAULT_DEBUG_FLAGS },
  constraints: { ...DEFAULT_CONSTRAINTS, blocking: [...DEFAULT_CONSTRAINTS.blocking] },
  openDoors: {},
  dragging: null,

  setViewMode: (viewMode) => set({ viewMode }),
  setCamera: (mode, roomId) =>
    set((s) => ({ camera: { mode, nonce: s.camera.nonce + 1, ...(roomId ? { roomId } : {}) } })),
  zoom: (delta) => set((s) => ({ zoomRequest: { delta, nonce: s.zoomRequest.nonce + 1 } })),
  select: (selection) => set((s) => (sameRef(s.selection, selection) ? s : { selection })),
  setHover: (hover) => set((s) => (sameRef(s.hover, hover) ? s : { hover })),
  toggleCeilings: () => set((s) => ({ showCeilings: !s.showCeilings })),
  setShowDimensions: (showDimensions) => set({ showDimensions }),
  setOverlay: (patch) => set((s) => ({ overlay: { ...s.overlay, ...patch } })),
  setLighting: (lighting) => set({ lighting }),
  setDebugEnabled: (enabled) => set((s) => ({ debug: { ...s.debug, enabled } })),
  setDebugFlag: (flag, v) => set((s) => ({ debug: { ...s.debug, flags: { ...s.debug.flags, [flag]: v } } })),
  setConstraints: (patch) => set((s) => ({ constraints: { ...s.constraints, ...patch } })),
  // Doors are drawn open on plans, so "no entry" means open.
  toggleDoor: (id) => set((s) => ({ openDoors: { ...s.openDoors, [id]: !(s.openDoors[id] ?? true) } })),
  setDragging: (dragging) => set({ dragging }),
}));
