import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { memo, useMemo } from 'react';
import type { Fixture } from '../../domain/types';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';
import { fixtureFrame } from '../builders/fixtureFrame';
import { getSurfaceMaterial } from '../materialCache';
import { HIGHLIGHT } from '../sceneConstants';

const WORKTOP = 0.04;

export function Fixtures() {
  const floor = useDocument(selectFloor);
  const selected = useScene((s) => (s.selection?.kind === 'fixture' ? s.selection.id : null));
  const roomPolys = useMemo(() => new Map(floor.rooms.map((r) => [r.id, r.polygon])), [floor.rooms]);
  return (
    <group name="fixtures">
      {floor.fixtures.map((fx) => (
        <FixtureMesh
          key={fx.id}
          fx={fx}
          roomPolygon={fx.roomId ? (roomPolys.get(fx.roomId) ?? null) : null}
          selected={selected === fx.id}
        />
      ))}
    </group>
  );
}

const FixtureMesh = memo(function FixtureMesh({
  fx,
  roomPolygon,
  selected,
}: {
  fx: Fixture;
  roomPolygon: Fixture['footprint'] | null;
  selected: boolean;
}) {
  const select = useScene((s) => s.select);
  const f = useMemo(() => fixtureFrame(fx.footprint, roomPolygon), [fx.footprint, roomPolygon]);
  const mat = getSurfaceMaterial(fx.materialId);
  const ceramic = getSurfaceMaterial('ceramic-white');
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select({ kind: 'fixture', id: fx.id });
  };
  const { width: w, depth: d } = f;
  const h = fx.height;

  let body: React.ReactNode;
  switch (fx.kind) {
    case 'kitchen-counter':
      body = (
        <>
          <mesh position={[0, (h - WORKTOP) / 2 + 0.05, 0.02]} material={mat} castShadow receiveShadow>
            <boxGeometry args={[w, h - WORKTOP - 0.1, d - 0.04]} />
          </mesh>
          <mesh position={[0, 0.05, -0.02]} material={getSurfaceMaterial('cabinet-dark')}>
            <boxGeometry args={[w, 0.1, d - 0.08]} />
          </mesh>
          <mesh
            position={[0, h - WORKTOP / 2, 0]}
            material={getSurfaceMaterial('counter-quartz')}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[w, WORKTOP, d]} />
          </mesh>
        </>
      );
      break;
    case 'bath':
      body = (
        <>
          <mesh position={[0, h / 2, 0]} material={ceramic} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
          </mesh>
          <mesh position={[0, h - 0.01, 0]} material={getSurfaceMaterial('fabric-slate')}>
            <boxGeometry args={[w - 0.12, 0.03, d - 0.14]} />
          </mesh>
        </>
      );
      break;
    case 'toilet':
      body = (
        <>
          <mesh position={[0, 0.4, -d / 2 + 0.09]} material={ceramic} castShadow>
            <boxGeometry args={[w * 0.9, 0.8, 0.18]} />
          </mesh>
          <mesh position={[0, 0.2, 0.06]} material={ceramic} castShadow scale={[1, 1, (d - 0.18) / w]}>
            <cylinderGeometry args={[w * 0.42, w * 0.32, 0.4, 24]} />
          </mesh>
        </>
      );
      break;
    case 'basin':
      body = (
        <>
          <mesh position={[0, (h - 0.15) / 2, -d / 4]} material={ceramic} castShadow>
            <boxGeometry args={[0.18, h - 0.15, 0.16]} />
          </mesh>
          <mesh position={[0, h - 0.075, 0]} material={ceramic} castShadow>
            <boxGeometry args={[w, 0.15, d]} />
          </mesh>
        </>
      );
      break;
    case 'sink':
    case 'hob':
      body = (
        <mesh position={[0, h / 2 + 0.001, 0]} material={mat}>
          <boxGeometry args={[w - 0.04, h, d - 0.04]} />
        </mesh>
      );
      break;
    default:
      body = (
        <mesh position={[0, h / 2, 0]} material={mat} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      );
  }

  return (
    <group
      name={`fixture-${fx.id}`}
      position={[f.center.x, fx.elevation, f.center.z]}
      rotation={[0, f.rotation, 0]}
      onClick={onClick}
    >
      {body}
      {selected && (
        <mesh position={[0, h / 2, 0]} raycast={() => null}>
          <boxGeometry args={[w + 0.01, h + 0.01, d + 0.01]} />
          <meshBasicMaterial visible={false} />
          <Edges color={HIGHLIGHT} />
        </mesh>
      )}
    </group>
  );
});
