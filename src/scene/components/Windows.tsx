import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { memo, useMemo } from 'react';
import { pointAlongWall } from '../../domain/geometry';
import type { Wall, Window } from '../../domain/types';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';
import { wallRotationY } from '../builders/wallPieces';
import { getSurfaceMaterial } from '../materialCache';
import { HIGHLIGHT } from '../sceneConstants';

const F = 0.05;
const DEPTH = 0.08;

export function Windows() {
  const windows = useDocument((s) => selectFloor(s).windows);
  const walls = useDocument((s) => selectFloor(s).walls);
  const selected = useScene((s) => (s.selection?.kind === 'window' ? s.selection.id : null));
  const wallById = useMemo(() => new Map(walls.map((w) => [w.id, w])), [walls]);
  return (
    <group name="windows">
      {windows.map((win) => {
        const wall = wallById.get(win.wallId);
        return wall ? <WindowMesh key={win.id} win={win} wall={wall} selected={selected === win.id} /> : null;
      })}
    </group>
  );
}

const WindowMesh = memo(function WindowMesh({
  win,
  wall,
  selected,
}: {
  win: Window;
  wall: Wall;
  selected: boolean;
}) {
  const select = useScene((s) => s.select);
  const c = pointAlongWall(wall, win.offset);
  const frame = getSurfaceMaterial(win.materialId);
  const glass = getSurfaceMaterial('glass');
  const { width: w, height: h } = win;
  // Large and glazed-door types get a central mullion.
  const mullions = win.kind === 'standard' && w < 1.2 ? 0 : Math.max(1, Math.round(w / 1.1) - 1);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select({ kind: 'window', id: win.id });
  };

  return (
    <group
      name={`window-${win.id}`}
      position={[c.x, win.sillHeight, c.z]}
      rotation={[0, wallRotationY(wall), 0]}
      onClick={onClick}
    >
      <mesh position={[0, h / 2, 0]} material={glass}>
        <boxGeometry args={[w - F, h - F, 0.012]} />
        {selected && <Edges color={HIGHLIGHT} lineWidth={2} />}
      </mesh>
      {[
        [-(w - F) / 2, h / 2, F, h],
        [(w - F) / 2, h / 2, F, h],
        [0, F / 2, w, F],
        [0, h - F / 2, w, F],
        ...Array.from({ length: mullions }, (_, i) => [
          -w / 2 + ((i + 1) * w) / (mullions + 1),
          h / 2,
          F * 0.8,
          h,
        ]),
      ].map(([x, y, sx, sy], i) => (
        <mesh key={i} position={[x!, y!, 0]} material={frame} castShadow>
          <boxGeometry args={[sx!, sy!, DEPTH]} />
        </mesh>
      ))}
      {win.sillHeight > 0.05 && (
        <mesh position={[0, -0.015, 0]} material={getSurfaceMaterial('wood-white')} receiveShadow>
          <boxGeometry args={[w + 0.08, 0.03, wall.thickness + 0.08]} />
        </mesh>
      )}
    </group>
  );
});
