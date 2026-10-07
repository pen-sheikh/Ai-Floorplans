import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import { useScene } from '../state/sceneStore';
import { Doors } from './components/Doors';
import { Fixtures } from './components/Fixtures';
import { Furniture } from './components/Furniture';
import { DebugLayer, DimensionLabels, PlanOverlay3D } from './components/Overlays';
import { CameraRig, Lighting } from './components/Rig';
import { RoomSurfaces } from './components/RoomSurfaces';
import { Walls } from './components/Walls';
import { Windows } from './components/Windows';
import { disposeMaterialCache } from './materialCache';

const BACKGROUND = { day: '#d6d6d4', interior: '#cfcfcc', night: '#1c2230' } as const;

/**
 * The 3D view. It renders whatever the document store contains and writes back only through
 * the store (selection, commands) — it holds no model data of its own.
 */
export default function ApartmentCanvas() {
  const select = useScene((s) => s.select);
  const lighting = useScene((s) => s.lighting);
  const dragging = useScene((s) => s.dragging);

  useEffect(() => () => disposeMaterialCache(), []);

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 42, near: 0.05, far: 300, position: [8, 12, 14] }}
      onPointerMissed={() => select(null)}
      data-testid="apartment-canvas"
    >
      <color attach="background" args={[BACKGROUND[lighting]]} />
      <Lighting />
      <RoomSurfaces />
      <Walls />
      <Doors />
      <Windows />
      <Fixtures />
      <Furniture />
      <Suspense fallback={null}>
        <PlanOverlay3D />
      </Suspense>
      <DebugLayer />
      <DimensionLabels />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        maxPolarAngle={Math.PI / 2 - 0.03}
        minDistance={0.3}
        maxDistance={80}
        enabled={!dragging}
      />
      <CameraRig />
    </Canvas>
  );
}
