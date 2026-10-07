import { Html, useTexture } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { planImageUrl } from '../../assets/planImages';
import { planImageWorldRect } from '../../domain/coordinates';
import {
  add,
  pointAlongWall,
  polygonBounds,
  rotateY,
  scale,
  wallFootprint,
  wallLength,
} from '../../domain/geometry';
import { roomMetrics } from '../../domain/topology';
import type { Floor, Vec2 } from '../../domain/types';
import { formatArea, formatLength } from '../../domain/units';
import { doorZones, frontClearanceZone, furnitureFootprint, windowZones } from '../../engine/placement';
import { selectFloor, useDocument } from '../../state/documentStore';
import type { PlacementConstraints } from '../../engine/constraints';
import { useScene } from '../../state/sceneStore';
import { doorLeafPoses } from '../builders/doorLeaves';
import { polygonOutline } from '../builders/shapes';
import { Z_LIFT } from '../sceneConstants';

/** The original plan image, placed with the same transform used to build the model. */
export function PlanOverlay3D() {
  const cs = useDocument((s) => s.apartment.coordinateSystem);
  const height = useDocument((s) => selectFloor(s).height);
  const overlay = useScene((s) => s.overlay);
  const url = cs.plan ? planImageUrl(cs.plan.image.file) : undefined;
  const rect = planImageWorldRect(cs);
  if (!overlay.visible || !url || !rect) return null;
  return (
    <PlanPlane
      url={url}
      rect={rect}
      y={overlay.position === 'above' ? height + 0.05 : Z_LIFT.planFloor}
      opacity={overlay.opacity}
    />
  );
}

function PlanPlane({
  url,
  rect,
  y,
  opacity,
}: {
  url: string;
  rect: { center: Vec2; width: number; depth: number };
  y: number;
  opacity: number;
}) {
  const tex = useTexture(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
  });
  return (
    <mesh
      position={[rect.center.x, y, rect.center.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
      renderOrder={10}
    >
      <planeGeometry args={[rect.width, rect.depth]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function Segments({ points, color, y = Z_LIFT.debug }: { points: number[]; color: string; y?: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return g;
  }, [points]);
  if (!points.length) return null;
  return (
    <lineSegments geometry={geo} position={[0, y - Z_LIFT.debug, 0]} raycast={() => null} renderOrder={20}>
      <lineBasicMaterial color={color} depthTest={false} transparent />
    </lineSegments>
  );
}

const outlines = (polys: Vec2[][], y = Z_LIFT.debug) => polys.flatMap((p) => polygonOutline(p, y));

function arcPoints(center: Vec2, radius: number, from: number, to: number, y: number): number[] {
  const out: number[] = [];
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const b = from + ((to - from) * (i + 1)) / steps;
    out.push(
      center.x + Math.cos(a) * radius,
      y,
      center.z - Math.sin(a) * radius,
      center.x + Math.cos(b) * radius,
      y,
      center.z - Math.sin(b) * radius,
    );
  }
  return out;
}

/** Geometry validation view: polygons, centrelines, wall bounds, swings, clearance zones, ids. */
export function DebugLayer() {
  const floor = useDocument(selectFloor);
  const debug = useScene((s) => s.debug);
  const constraints = useScene((s) => s.constraints);
  const layers = useMemo(() => buildDebugLayers(floor, constraints), [floor, constraints]);
  if (!debug.enabled) return null;
  const f = debug.flags;
  return (
    <group name="debug">
      {f.roomBoundaries && <Segments points={layers.rooms} color="#2563eb" />}
      {f.wallBounds && <Segments points={layers.wallBounds} color="#dc2626" />}
      {f.wallCenterlines && <Segments points={layers.centerlines} color="#f97316" />}
      {f.doorSwings && <Segments points={layers.swings} color="#16a34a" />}
      {f.windows && <Segments points={layers.windows} color="#0891b2" y={Z_LIFT.debug + 0.9} />}
      {f.furnitureBounds && <Segments points={layers.furniture} color="#9333ea" />}
      {f.collisionZones && <Segments points={layers.zones} color="#e11d48" />}
      {f.roomIds &&
        floor.rooms.map((r) => {
          const c = roomMetrics(r).centroid;
          return (
            <Html
              key={r.id}
              position={[c.x, 0.05, c.z]}
              center
              className="scene-label scene-label--debug"
              zIndexRange={[20, 0]}
            >
              {r.id}
            </Html>
          );
        })}
      {f.dimensions &&
        floor.walls.map((w) => {
          const m = pointAlongWall(w, wallLength(w) / 2);
          return (
            <Html
              key={w.id}
              position={[m.x, w.height + 0.05, m.z]}
              center
              className="scene-label scene-label--wall"
              zIndexRange={[20, 0]}
            >
              {formatLength(wallLength(w))}
            </Html>
          );
        })}
    </group>
  );
}

function buildDebugLayers(floor: Floor, constraints: PlacementConstraints) {
  const wallById = new Map(floor.walls.map((w) => [w.id, w]));
  const y = Z_LIFT.debug;
  const swings: number[] = [];
  const zones: Vec2[][] = [];
  for (const door of floor.doors) {
    const wall = wallById.get(door.wallId);
    if (!wall) continue;
    for (const pose of doorLeafPoses(door, wall)) {
      const a0 = pose.closedAngle;
      const a1 = pose.closedAngle + pose.openDelta * pose.maxOpen;
      swings.push(...arcPoints(pose.hinge, pose.width, Math.min(a0, a1), Math.max(a0, a1), y));
      const tip = {
        x: pose.hinge.x + Math.cos(a1) * pose.width,
        z: pose.hinge.z - Math.sin(a1) * pose.width,
      };
      swings.push(pose.hinge.x, y, pose.hinge.z, tip.x, y, tip.z);
    }
    const z = doorZones(door, wall, constraints);
    if (z.swing) zones.push(z.swing);
    zones.push(...z.clearance);
  }
  for (const win of floor.windows) {
    const wall = wallById.get(win.wallId);
    if (wall) zones.push(...windowZones(win, wall, constraints));
  }
  const windows: number[] = [];
  for (const win of floor.windows) {
    const wall = wallById.get(win.wallId);
    if (!wall) continue;
    const a = pointAlongWall(wall, win.offset - win.width / 2);
    const b = pointAlongWall(wall, win.offset + win.width / 2);
    windows.push(a.x, y, a.z, b.x, y, b.z);
  }
  for (const item of floor.furniture) {
    const zone = frontClearanceZone(item, constraints);
    if (zone) zones.push(zone);
  }
  return {
    rooms: outlines(floor.rooms.map((r) => r.polygon)),
    wallBounds: outlines(floor.walls.map(wallFootprint), y + 0.01),
    centerlines: floor.walls.flatMap((w) => [w.start.x, y, w.start.z, w.end.x, y, w.end.z]),
    swings,
    windows,
    furniture: outlines(floor.furniture.map(furnitureFootprint), y + 0.02),
    zones: outlines(zones),
  };
}

/** Optional measurement labels: room extents and area, flagged as estimates. */
export function DimensionLabels() {
  const floor = useDocument(selectFloor);
  const show = useScene((s) => s.showDimensions);
  if (!show) return null;
  return (
    <group name="dimensions">
      {floor.rooms
        .filter((r) => r.type !== 'storage')
        .map((r) => {
          const m = roomMetrics(r);
          const b = polygonBounds(r.polygon);
          const label = r.planLabel?.dimensions
            ? `Plan: ${r.planLabel.dimensions[0].toFixed(2)} × ${r.planLabel.dimensions[1].toFixed(2)} m`
            : null;
          return (
            <group key={r.id}>
              <Html
                position={[m.centroid.x, 0.1, m.centroid.z]}
                center
                className="scene-label"
                zIndexRange={[15, 0]}
              >
                <strong>{r.name}</strong>
                <span>{formatArea(m.area)}</span>
                {label && <span className="scene-label__muted">{label}</span>}
              </Html>
              <Html
                position={[(b.minX + b.maxX) / 2, 0.1, b.minZ + 0.15]}
                center
                className="scene-label scene-label--dim"
                zIndexRange={[15, 0]}
              >
                ↔ {formatLength(m.width)}
              </Html>
              <Html
                position={[b.minX + 0.2, 0.1, (b.minZ + b.maxZ) / 2]}
                center
                className="scene-label scene-label--dim"
                zIndexRange={[15, 0]}
              >
                ↕ {formatLength(m.depth)}
              </Html>
            </group>
          );
        })}
      {floor.furniture.map((f) => {
        const front = add(
          f.position,
          scale(rotateY({ x: 0, z: 1 }, f.rotation), f.dimensions.depth / 2 + 0.12),
        );
        return (
          <Html
            key={f.id}
            position={[front.x, 0.05, front.z]}
            center
            className="scene-label scene-label--dim"
            zIndexRange={[15, 0]}
          >
            {f.dimensions.width.toFixed(2)} × {f.dimensions.depth.toFixed(2)} m
          </Html>
        );
      })}
    </group>
  );
}
