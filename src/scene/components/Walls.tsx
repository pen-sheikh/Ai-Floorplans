import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo } from 'react';
import type * as THREE from 'three';
import { roomsBesideWall } from '../../domain/topology';
import type { Floor, Room, Wall } from '../../domain/types';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';
import { openingSpans, pieceTransform, wallPieces, type WallPiece } from '../builders/wallPieces';
import { getColorMaterial, getSurfaceMaterial, metricBoxGeometry } from '../materialCache';
import { HIGHLIGHT, WALL_CUT } from '../sceneConstants';

type Layout = Pick<Floor, 'walls' | 'doors' | 'windows' | 'rooms'>;

/** Rooms on each side of every wall piece. Depends only on geometry, so it is computed once per layout. */
function useSideRooms({
  walls,
  doors,
  windows,
  rooms,
}: Layout): Map<string, [string | null, string | null][]> {
  const geometryKey = useMemo(
    () =>
      JSON.stringify([
        walls,
        doors.map((d) => [d.wallId, d.offset, d.width, d.height]),
        windows.map((w) => [w.wallId, w.offset, w.width]),
        rooms.map((r) => r.polygon),
      ]),
    [walls, doors, windows, rooms],
  );
  return useMemo(() => {
    const out = new Map<string, [string | null, string | null][]>();
    for (const wall of walls) {
      const pieces = wallPieces(wall, openingSpans(wall, doors, windows));
      out.set(
        wall.id,
        pieces.map((p) => {
          const [a, b] = roomsBesideWall({ rooms }, wall, (p.from + p.to) / 2);
          return [a?.id ?? null, b?.id ?? null];
        }),
      );
    }
    return out;
    // geometryKey captures every input that affects the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey]);
}

export function Walls() {
  // Subscribe to the arrays walls depend on — not the whole floor — so furniture edits
  // (which leave these arrays referentially identical) do not re-render any wall.
  const walls = useDocument((s) => selectFloor(s).walls);
  const doors = useDocument((s) => selectFloor(s).doors);
  const windows = useDocument((s) => selectFloor(s).windows);
  const rooms = useDocument((s) => selectFloor(s).rooms);
  const selected = useScene((s) => (s.selection?.kind === 'wall' ? s.selection.id : null));
  const sideRooms = useSideRooms({ walls, doors, windows, rooms });
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  return (
    <group name="walls">
      {walls.map((wall) => (
        <WallMesh
          key={wall.id}
          wall={wall}
          openingsKey={JSON.stringify(openingSpans(wall, doors, windows))}
          sides={sideRooms.get(wall.id) ?? []}
          roomById={roomById}
          selected={selected === wall.id}
        />
      ))}
    </group>
  );
}

interface WallMeshProps {
  wall: Wall;
  openingsKey: string;
  sides: [string | null, string | null][];
  roomById: Map<string, Room>;
  selected: boolean;
}

const faceMaterial = (wall: Wall, room: Room | undefined): THREE.Material =>
  room
    ? getSurfaceMaterial(room.renovation.wallMaterialId, room.renovation.wallColor)
    : getSurfaceMaterial(wall.materialId);

const WallMesh = memo(function WallMesh({ wall, openingsKey, sides, roomById, selected }: WallMeshProps) {
  const select = useScene((s) => s.select);
  const pieces = useMemo<WallPiece[]>(() => wallPieces(wall, JSON.parse(openingsKey)), [wall, openingsKey]);
  const geometries = useMemo(
    () =>
      pieces
        .map((p) => pieceTransform(wall, p))
        .map((t) => ({ t, geo: metricBoxGeometry(t.size.length, t.size.height, t.size.thickness) })),
    [wall, pieces],
  );
  useEffect(() => () => geometries.forEach((g) => g.geo.dispose()), [geometries]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select({ kind: 'wall', id: wall.id });
  };

  const isRailing = wall.kind === 'railing';
  const cut = getColorMaterial(WALL_CUT);
  return (
    <group name={`wall-${wall.id}`}>
      {geometries.map(({ t, geo }, i) => {
        const [negId, posId] = sides[i] ?? [null, null];
        const neg = faceMaterial(wall, negId ? roomById.get(negId) : undefined);
        const pos = faceMaterial(wall, posId ? roomById.get(posId) : undefined);
        const glass = getSurfaceMaterial(wall.materialId);
        // BoxGeometry groups: +x, −x, +y (top), −y, +z (normal side), −z.
        const mats = isRailing ? glass : [pos, pos, cut, cut, pos, neg];
        return (
          <mesh
            key={i}
            geometry={geo}
            material={mats}
            position={[t.center.x, t.center.y, t.center.z]}
            rotation={[0, t.rotationY, 0]}
            castShadow={!isRailing}
            receiveShadow
            onClick={onClick}
          >
            {selected && <Edges color={HIGHLIGHT} lineWidth={2} />}
          </mesh>
        );
      })}
      {isRailing && <RailingTop wall={wall} />}
    </group>
  );
});

/** Handrail along the top of a glass balustrade. */
function RailingTop({ wall }: { wall: Wall }) {
  const t = pieceTransform(wall, {
    kind: 'solid',
    from: 0,
    to: Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z),
    bottom: wall.height - 0.04,
    top: wall.height,
  });
  return (
    <mesh
      position={[t.center.x, t.center.y, t.center.z]}
      rotation={[0, t.rotationY, 0]}
      material={getSurfaceMaterial('aluminium-dark')}
      castShadow
    >
      <boxGeometry args={[t.size.length, 0.04, 0.06]} />
    </mesh>
  );
}
