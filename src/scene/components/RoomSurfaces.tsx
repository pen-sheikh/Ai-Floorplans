import type { ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Room, Vec2 } from '../../domain/types';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';
import { polygonGeometry, polygonOutline, polygonRotationX } from '../builders/shapes';
import { getColorMaterial, getSurfaceMaterial } from '../materialCache';
import { HIGHLIGHT, HOVER, SLAB_THICKNESS, Z_LIFT } from '../sceneConstants';

export function RoomSurfaces() {
  const rooms = useDocument((s) => selectFloor(s).rooms);
  const footprint = useDocument((s) => selectFloor(s).footprint);
  const showCeilings = useScene((s) => s.showCeilings);
  const selected = useScene((s) => (s.selection?.kind === 'room' ? s.selection.id : null));
  const hovered = useScene((s) => (s.hover?.kind === 'room' ? s.hover.id : null));
  return (
    <group name="rooms">
      {/* A floor plan need not draw a floor: without a usable outline the slab is derived
          from the room polygons (each room's floor comes from its polygon anyway). */}
      {footprint.length >= 3 ? (
        <Slab footprint={footprint} />
      ) : (
        rooms.map((room) => <Slab key={`slab-${room.id}`} footprint={room.polygon} />)
      )}
      {rooms.map((room) => (
        <RoomSurface
          key={room.id}
          room={room}
          showCeiling={showCeilings && !room.exterior}
          state={selected === room.id ? 'selected' : hovered === room.id ? 'hover' : 'none'}
        />
      ))}
    </group>
  );
}

/** Structural slab under the whole unit (also fills door thresholds inside wall thickness). */
function Slab({ footprint }: { footprint: Vec2[] }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape(footprint.map((p) => new THREE.Vector2(p.x, -p.z)));
    return new THREE.ExtrudeGeometry(shape, { depth: SLAB_THICKNESS, bevelEnabled: false });
  }, [footprint]);
  useEffect(() => () => geo.dispose(), [geo]);
  // Extrusion runs along +Z in shape space; after −90° about X it runs along +Y, so shift down.
  return (
    <mesh
      geometry={geo}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -SLAB_THICKNESS - 0.002, 0]}
      material={getSurfaceMaterial('slab')}
      receiveShadow
    />
  );
}

interface RoomSurfaceProps {
  room: Room;
  showCeiling: boolean;
  state: 'none' | 'hover' | 'selected';
}

const RoomSurface = memo(function RoomSurface({ room, showCeiling, state }: RoomSurfaceProps) {
  const select = useScene((s) => s.select);
  const setHover = useScene((s) => s.setHover);
  const setCamera = useScene((s) => s.setCamera);
  const floorGeo = useMemo(() => polygonGeometry(room.polygon, 'up'), [room.polygon]);
  const ceilingGeo = useMemo(() => polygonGeometry(room.polygon, 'down'), [room.polygon]);
  const outline = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(polygonOutline(room.polygon, Z_LIFT.outline), 3),
    );
    return g;
  }, [room.polygon]);
  useEffect(
    () => () => [floorGeo, ceilingGeo, outline].forEach((g) => g.dispose()),
    [floorGeo, ceilingGeo, outline],
  );

  const r = room.renovation;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select({ kind: 'room', id: room.id });
  };

  return (
    <group name={`room-${room.id}`}>
      <mesh
        geometry={floorGeo}
        rotation={[polygonRotationX('up'), 0, 0]}
        material={getSurfaceMaterial(r.floorMaterialId, r.floorColor)}
        receiveShadow
        onClick={onClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setCamera('room', room.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover({ kind: 'room', id: room.id });
        }}
        onPointerOut={() => setHover(null)}
      />
      {showCeiling && (
        <mesh
          geometry={ceilingGeo}
          rotation={[polygonRotationX('down'), 0, 0]}
          position={[0, room.ceilingHeight, 0]}
          material={getSurfaceMaterial(r.ceilingMaterialId, r.ceilingColor)}
        />
      )}
      {state === 'selected' && (
        <mesh
          geometry={floorGeo}
          rotation={[polygonRotationX('up'), 0, 0]}
          position={[0, Z_LIFT.overlay, 0]}
          material={getColorMaterial(HIGHLIGHT, { opacity: 0.22 })}
          raycast={() => null}
        />
      )}
      {state !== 'none' && (
        <lineSegments geometry={outline} raycast={() => null}>
          <lineBasicMaterial color={state === 'selected' ? HIGHLIGHT : HOVER} />
        </lineSegments>
      )}
    </group>
  );
});
