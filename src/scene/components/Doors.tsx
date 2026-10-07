import { Edges } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { memo, useLayoutEffect, useRef } from 'react';
import type * as THREE from 'three';
import { pointAlongWall } from '../../domain/geometry';
import type { Door, Wall } from '../../domain/types';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';
import { doorLeafPoses, type LeafPose } from '../builders/doorLeaves';
import { wallRotationY } from '../builders/wallPieces';
import { getSurfaceMaterial } from '../materialCache';
import { HIGHLIGHT } from '../sceneConstants';

const LEAF_THICKNESS = 0.04;
const FRAME = 0.04;
/** Doors render open at this fraction by default (plans draw them open). */
const DEFAULT_OPEN = 0.9;

export function Doors() {
  const floor = useDocument(selectFloor);
  const selected = useScene((s) => (s.selection?.kind === 'door' ? s.selection.id : null));
  const openDoors = useScene((s) => s.openDoors);
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));
  return (
    <group name="doors">
      {floor.doors.map((door) => {
        const wall = wallById.get(door.wallId);
        return wall ? (
          <DoorMesh
            key={door.id}
            door={door}
            wall={wall}
            open={openDoors[door.id] ?? true}
            selected={selected === door.id}
          />
        ) : null;
      })}
    </group>
  );
}

interface DoorMeshProps {
  door: Door;
  wall: Wall;
  open: boolean;
  selected: boolean;
}

const DoorMesh = memo(function DoorMesh({ door, wall, open, selected }: DoorMeshProps) {
  const select = useScene((s) => s.select);
  const toggleDoor = useScene((s) => s.toggleDoor);
  const leaves = doorLeafPoses(door, wall);
  const frameMat = getSurfaceMaterial('wood-white');
  const leafMat = getSurfaceMaterial(door.materialId);
  const center = pointAlongWall(wall, door.offset);
  const rot = wallRotationY(wall);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select({ kind: 'door', id: door.id });
  };
  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    toggleDoor(door.id);
  };

  return (
    <group name={`door-${door.id}`} onClick={onClick} onDoubleClick={onDoubleClick}>
      {door.kind !== 'opening' && (
        // Frame: two jambs and a head, centred in the wall.
        <group position={[center.x, 0, center.z]} rotation={[0, rot, 0]}>
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={[(s * (door.width + FRAME)) / 2, door.height / 2, 0]}
              material={frameMat}
              castShadow
            >
              <boxGeometry args={[FRAME, door.height, wall.thickness + 0.02]} />
            </mesh>
          ))}
          <mesh position={[0, door.height + FRAME / 2, 0]} material={frameMat}>
            <boxGeometry args={[door.width + FRAME * 2, FRAME, wall.thickness + 0.02]} />
          </mesh>
        </group>
      )}
      {door.kind === 'sliding' && (
        <SlidingLeaf door={door} wall={wall} open={open} material={leafMat} selected={selected} />
      )}
      {leaves.map((pose, i) => (
        <Leaf key={i} pose={pose} height={door.height} open={open} material={leafMat} selected={selected} />
      ))}
      {selected && door.kind === 'opening' && (
        <mesh position={[center.x, door.height / 2, center.z]} rotation={[0, rot, 0]}>
          <boxGeometry args={[door.width, door.height, wall.thickness]} />
          <meshBasicMaterial transparent opacity={0.12} color={HIGHLIGHT} depthWrite={false} />
          <Edges color={HIGHLIGHT} />
        </mesh>
      )}
    </group>
  );
});

function Leaf({
  pose,
  height,
  open,
  material,
  selected,
}: {
  pose: LeafPose;
  height: number;
  open: boolean;
  material: THREE.Material;
  selected: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const target = open ? DEFAULT_OPEN * pose.maxOpen : 0;
  const current = useRef(target);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const diff = target - current.current;
    if (Math.abs(diff) < 1e-3) return;
    current.current += diff * Math.min(1, dt * 6);
    ref.current.rotation.y = pose.closedAngle + pose.openDelta * current.current;
  });
  // Re-apply the pose when the door geometry changes; useFrame animates open/close.
  useLayoutEffect(() => {
    if (ref.current) ref.current.rotation.y = pose.closedAngle + pose.openDelta * current.current;
  }, [pose.closedAngle, pose.openDelta]);
  const w = pose.width - 0.01;
  return (
    <group ref={ref} position={[pose.hinge.x, 0, pose.hinge.z]}>
      <mesh position={[w / 2, height / 2, 0]} material={material} castShadow>
        <boxGeometry args={[w, height - 0.01, LEAF_THICKNESS]} />
        {selected && <Edges color={HIGHLIGHT} />}
      </mesh>
      <mesh position={[w - 0.07, 1.0, 0]} material={getSurfaceMaterial('steel')}>
        <boxGeometry args={[0.12, 0.02, LEAF_THICKNESS + 0.05]} />
      </mesh>
    </group>
  );
}

function SlidingLeaf({
  door,
  wall,
  open,
  material,
  selected,
}: {
  door: Door;
  wall: Wall;
  open: boolean;
  material: THREE.Material;
  selected: boolean;
}) {
  const shift = open ? door.width * 0.9 : 0;
  const p = pointAlongWall(wall, door.offset - shift, door.swingSide * (wall.thickness / 2 + 0.03));
  return (
    <mesh
      position={[p.x, door.height / 2, p.z]}
      rotation={[0, wallRotationY(wall), 0]}
      material={material}
      castShadow
    >
      <boxGeometry args={[door.width, door.height - 0.01, LEAF_THICKNESS]} />
      {selected && <Edges color={HIGHLIGHT} />}
    </mesh>
  );
}
