import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonArea, vec, wallLength } from '../../domain/geometry';
import type { Wall } from '../../domain/types';
import { e2, e2Floor } from '../../test/fixtures';
import { cameraPose, roomPose } from './cameraPoses';
import { doorLeafPoses, leafTip } from './doorLeaves';
import { polygonGeometry } from './shapes';
import { openingSpans, pieceTransform, piecesVolume, wallPieces, wallRotationY } from './wallPieces';

const wall: Wall = {
  id: 'w',
  start: vec(0, 0),
  end: vec(4, 0),
  thickness: 0.2,
  height: 2.4,
  kind: 'interior',
  materialId: 'paint-white',
  source: 'plan-geometry',
};

describe('wall mesh builder', () => {
  it('splits a wall around a door and a window', () => {
    const pieces = wallPieces(wall, [
      { id: 'door', from: 0.5, to: 1.3, bottom: 0, top: 2.0 },
      { id: 'win', from: 2.5, to: 3.5, bottom: 0.9, top: 2.1 },
    ]);
    expect(pieces.map((p) => p.kind)).toEqual(['solid', 'lintel', 'solid', 'sill', 'lintel', 'solid']);
    const full = wallLength(wall) * wall.height * wall.thickness;
    const holes = 0.8 * 2.0 * 0.2 + 1.0 * 1.2 * 0.2;
    expect(piecesVolume(wall, pieces)).toBeCloseTo(full - holes);
  });

  it('handles openings at the wall ends and full-height openings', () => {
    const pieces = wallPieces(wall, [{ id: 'gap', from: 0, to: 1, bottom: 0, top: 2.4 }]);
    expect(pieces).toEqual([{ kind: 'solid', from: 1, to: 4, bottom: 0, top: 2.4 }]);
  });

  it('orients boxes along the wall (local +X = wall direction)', () => {
    const diag: Wall = { ...wall, end: vec(3, 4) };
    const t = pieceTransform(diag, { kind: 'solid', from: 0, to: 5, bottom: 0, top: 2.4 });
    const dir = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, wallRotationY(diag), 0));
    expect(dir.x).toBeCloseTo(0.6);
    expect(dir.z).toBeCloseTo(0.8);
    expect(t.center).toMatchObject({ x: 1.5, y: 1.2, z: 2 });
  });
});

describe('E2 plan → 3D scene (integration)', () => {
  const floor = e2Floor();

  it('builds wall pieces for every wall with gaps exactly where openings are', () => {
    for (const w of floor.walls) {
      const spans = openingSpans(w, floor.doors, floor.windows);
      const pieces = wallPieces(w, spans);
      expect(pieces.length).toBeGreaterThan(0);
      const open = spans.reduce((a, s) => a + (s.to - s.from) * (s.top - s.bottom) * w.thickness, 0);
      expect(piecesVolume(w, pieces)).toBeCloseTo(wallLength(w) * w.height * w.thickness - open, 6);
    }
  });

  it('swings every door leaf into the room recorded from the plan arc', () => {
    for (const door of floor.doors) {
      const w = floor.walls.find((x) => x.id === door.wallId)!;
      const swingRoomId = door.connects[door.swingSide === 1 ? 1 : 0];
      const swingRoom = floor.rooms.find((r) => r.id === swingRoomId);
      for (const pose of doorLeafPoses(door, w)) {
        const closedTip = leafTip(pose, 0);
        const openTip = leafTip(pose, pose.maxOpen * 0.95);
        // Closed: the leaf spans the opening along the wall centreline.
        expect(Math.abs(closedTip.x - pose.hinge.x) + Math.abs(closedTip.z - pose.hinge.z)).toBeCloseTo(
          pose.width,
          5,
        );
        if (swingRoom) expect(pointInPolygon(openTip, swingRoom.polygon)).toBe(true);
      }
    }
  });

  it('triangulates every room floor with the same area as the model polygon', () => {
    for (const room of floor.rooms) {
      const geo = polygonGeometry(room.polygon, 'up');
      const pos = geo.getAttribute('position');
      const index = geo.getIndex()!;
      let area = 0;
      for (let i = 0; i < index.count; i += 3) {
        const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map((k) =>
          new THREE.Vector3().fromBufferAttribute(pos, k),
        );
        area += new THREE.Triangle(a!, b!, c!).getArea();
      }
      expect(area).toBeCloseTo(polygonArea(room.polygon), 4);
      geo.dispose();
    }
  });

  it('does not stand the room camera inside furniture', () => {
    const r = floor.rooms.find((x) => x.id === 'bedroom-1')!;
    const first = roomPose(r.polygon);
    const at = { x: first.position[0], z: first.position[2] };
    const bed = [
      { x: at.x - 0.8, z: at.z - 1 },
      { x: at.x + 0.8, z: at.z - 1 },
      { x: at.x + 0.8, z: at.z + 1 },
      { x: at.x - 0.8, z: at.z + 1 },
    ];
    const p = roomPose(r.polygon, [bed]);
    const pos = { x: p.position[0], z: p.position[2] };
    expect(pointInPolygon(pos, bed)).toBe(false);
    expect(pointInPolygon(pos, r.polygon)).toBe(true);
  });

  it('derives camera poses from the model', () => {
    const top = cameraPose('top', floor);
    expect(top.position[0]).toBeCloseTo(top.target[0]);
    expect(top.position[1]).toBeGreaterThan(8);
    for (const r of floor.rooms.filter((x) => polygonArea(x.polygon) > 2.5)) {
      const p = roomPose(r.polygon);
      expect(pointInPolygon({ x: p.position[0], z: p.position[2] }, r.polygon)).toBe(true);
      expect(p.position[1]).toBeCloseTo(1.6);
    }
  });

  it('keeps the canonical model free of three.js objects', () => {
    const json = JSON.stringify(e2());
    expect(json).not.toMatch(/"isMesh"|"uuid"|"isObject3D"/);
  });
});
