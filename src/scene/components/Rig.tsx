import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { roomMetrics } from '../../domain/topology';
import { furnitureFootprint } from '../../engine/placement';
import type { LightingPreset } from '../../domain/types';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';
import { cameraPose, floorBounds } from '../builders/cameraPoses';

interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

/** Smoothly moves the camera to model-derived poses when the camera mode changes. */
export function CameraRig() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const cam = useScene((s) => s.camera);
  const zoomRequest = useScene((s) => s.zoomRequest);
  const anim = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  useEffect(() => {
    const floor = selectFloor(useDocument.getState());
    const persp = camera instanceof THREE.PerspectiveCamera ? camera : null;
    const obstacles = [...floor.furniture.map(furnitureFootprint), ...floor.fixtures.map((f) => f.footprint)];
    const pose = cameraPose(cam.mode, floor, cam.roomId, persp?.fov ?? 42, persp?.aspect ?? 1.5, obstacles);
    anim.current = { pos: new THREE.Vector3(...pose.position), target: new THREE.Vector3(...pose.target) };
  }, [cam.nonce, cam.mode, cam.roomId, camera]);

  useEffect(() => {
    if (!zoomRequest.nonce || !controls) return;
    const target = controls.target.clone();
    const offset = camera.position.clone().sub(target);
    offset.multiplyScalar(zoomRequest.delta > 0 ? 0.75 : 1.33);
    anim.current = { pos: target.clone().add(offset), target };
  }, [zoomRequest, controls, camera]);

  useEffect(() => {
    if (!controls) return;
    const cancel = () => {
      anim.current = null;
    };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    const k = 1 - Math.exp(-dt * 7);
    camera.position.lerp(a.pos, k);
    controls.target.lerp(a.target, k);
    controls.update();
    if (camera.position.distanceTo(a.pos) < 0.02 && controls.target.distanceTo(a.target) < 0.02) {
      // Snap exactly: the top view's tiny horizontal offset defines its azimuth, so an
      // approximate stop would leave the plan rotated by the previous view's azimuth.
      camera.position.copy(a.pos);
      controls.target.copy(a.target);
      controls.update();
      anim.current = null;
    }
  });

  return null;
}

const LIGHT_COLORS: Record<LightingPreset, string> = {
  warm: '#ffd2a1',
  neutral: '#fff3e2',
  cool: '#e3eeff',
  off: '#000000',
};

/** Day / night / interior lighting. Sun direction follows the plan's compass when available. */
export function Lighting() {
  const mode = useScene((s) => s.lighting);
  const floor = useDocument(selectFloor);
  const north = useDocument((s) => s.apartment.coordinateSystem.north);
  const bounds = useMemo(() => floorBounds(floor), [floor]);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);

  const { center: c, size: s } = bounds;
  const n = north ?? { x: 0, z: -1 };
  const south = { x: -n.x, z: -n.z };
  const east = { x: -n.z, z: n.x };
  const sunPos: [number, number, number] = [
    c.x + s * (south.x * 0.9 + east.x * 0.35),
    s * 1.3,
    c.z + s * (south.z * 0.9 + east.z * 0.35),
  ];

  // Ceilings shade interiors from the sun, so rooms keep a soft fill light even by day.
  const roomLights = floor.rooms.filter(
    (r) => !r.exterior && r.type !== 'storage' && r.renovation.lighting !== 'off',
  );
  const roomIntensity = mode === 'night' ? 6 : mode === 'interior' ? 3.5 : 1.6;

  return (
    <>
      <primitive object={sunTarget} position={[c.x, 0, c.z]} />
      <hemisphereLight
        args={['#ffffff', '#b9b2a6', mode === 'day' ? 1.1 : mode === 'interior' ? 0.55 : 0.08]}
      />
      <ambientLight
        intensity={mode === 'night' ? 0.05 : 0.45}
        color={mode === 'night' ? '#8aa0c8' : '#ffffff'}
      />
      {mode === 'day' && (
        <directionalLight
          position={sunPos}
          target={sunTarget}
          intensity={2.4}
          color="#fff6e8"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
          shadow-camera-left={-s * 0.75}
          shadow-camera-right={s * 0.75}
          shadow-camera-top={s * 0.75}
          shadow-camera-bottom={-s * 0.75}
          shadow-camera-near={0.5}
          shadow-camera-far={s * 4}
        />
      )}
      {roomLights.map((r) => {
        const m = roomMetrics(r);
        return (
          <pointLight
            key={r.id}
            position={[m.centroid.x, r.ceilingHeight - 0.25, m.centroid.z]}
            color={LIGHT_COLORS[r.renovation.lighting]}
            intensity={roomIntensity}
            distance={Math.max(m.width, m.depth) * 1.6}
            decay={1.4}
          />
        );
      })}
    </>
  );
}
