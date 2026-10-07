import { Edges } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, Suspense, useRef } from 'react';
import * as THREE from 'three';
import { getCatalogItem } from '../../catalog/furnitureCatalog';
import type { FurnitureItem, Vec2 } from '../../domain/types';
import { planTransform } from '../../editor/operations';
import { furnitureConflicts } from '../../engine/conflicts';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';
import { useUi } from '../../state/uiStore';
import { getSurfaceMaterial } from '../materialCache';
import { HIGHLIGHT } from '../sceneConstants';
import { GltfModel, ProceduralModel } from './FurnitureModels';

const CONFLICT = '#ef4444';
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function Furniture() {
  const floor = useDocument(selectFloor);
  const constraints = useScene((s) => s.constraints);
  const visible = useScene((s) => s.showFurniture);
  const selected = useScene((s) => (s.selection?.kind === 'furniture' ? s.selection.id : null));
  // Conflicts are recomputed from the model; nothing about validity is stored on meshes.
  const conflicts = furnitureConflicts(floor, constraints);
  if (!visible) return null;
  return (
    <group name="furniture">
      {floor.furniture.map((item) => (
        <FurnitureMesh
          key={item.id}
          item={item}
          selected={selected === item.id}
          conflict={conflicts.has(item.id)}
        />
      ))}
    </group>
  );
}

const FurnitureMesh = memo(function FurnitureMesh({
  item,
  selected,
  conflict,
}: {
  item: FurnitureItem;
  selected: boolean;
  conflict: boolean;
}) {
  const select = useScene((s) => s.select);
  const setDragging = useScene((s) => s.setDragging);
  const get = useThree((s) => s.get);
  const setControlsEnabled = (enabled: boolean) => {
    const controls = get().controls as unknown as { enabled: boolean } | null;
    if (controls) controls.enabled = enabled;
  };
  const grab = useRef<Vec2 | null>(null);
  const lastBlocked = useRef<string | null>(null);
  const cat = getCatalogItem(item.catalogId);
  const main = getSurfaceMaterial(item.materialId, item.color);
  const { width: w, depth: d, height: h } = item.dimensions;

  const hit = (e: ThreeEvent<PointerEvent>): Vec2 | null => {
    const p = e.ray.intersectPlane(floorPlane, new THREE.Vector3());
    return p ? { x: p.x, z: p.z } : null;
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    select({ kind: 'furniture', id: item.id });
    if (e.button !== 0) return;
    const p = hit(e);
    if (!p) return;
    grab.current = { x: item.position.x - p.x, z: item.position.z - p.z };
    (e.target as unknown as Element).setPointerCapture(e.pointerId);
    setControlsEnabled(false);
    setDragging(item.id);
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!grab.current) return;
    e.stopPropagation();
    const p = hit(e);
    if (!p) return;
    const position = {
      x: Math.round((p.x + grab.current.x) * 100) / 100,
      z: Math.round((p.z + grab.current.z) * 100) / 100,
    };
    const doc = useDocument.getState();
    const { command, result } = planTransform(
      selectFloor(doc),
      item.id,
      { position },
      useScene.getState().constraints,
    );
    if (command) {
      doc.dispatch(command, { coalesceKey: `drag-${item.id}` });
      lastBlocked.current = null;
    } else if (result) {
      const reason =
        result.issues.find((i) => useScene.getState().constraints.blocking.includes(i.code))?.message ?? null;
      if (reason && reason !== lastBlocked.current) useUi.getState().toast('warning', reason);
      lastBlocked.current = reason;
    }
  };

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!grab.current) return;
    grab.current = null;
    lastBlocked.current = null;
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    setControlsEnabled(true);
    setDragging(null);
    useDocument.getState().endCoalesce();
  };

  return (
    <group
      name={`furniture-${item.id}`}
      position={[item.position.x, item.elevation, item.position.z]}
      rotation={[0, item.rotation, 0]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => e.stopPropagation()}
    >
      {cat?.asset.kind === 'gltf' ? (
        <Suspense fallback={<ProceduralModel category={item.category} dims={item.dimensions} main={main} />}>
          <GltfModel asset={cat.asset} dims={item.dimensions} />
        </Suspense>
      ) : (
        <ProceduralModel category={item.category} dims={item.dimensions} main={main} />
      )}
      {/* Invisible pick box covering the real-world bounding box (easier to grab than thin parts). */}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, Math.max(h, 0.02), d]} />
        <meshBasicMaterial visible={false} />
        {(selected || conflict) && (
          <Edges color={conflict ? CONFLICT : HIGHLIGHT} lineWidth={selected ? 2 : 1} />
        )}
      </mesh>
    </group>
  );
});
