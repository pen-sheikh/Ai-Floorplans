import { pointAlongWall, rotateY, scale, wallDirection, wallNormal } from '../../domain/geometry';
import type { Door, Vec2, Wall } from '../../domain/types';

/**
 * Door leaf kinematics, derived only from the model (wall, offset, hinge side, swing side).
 * A leaf is a box spanning local +X from its hinge; `closedAngle` aligns it with the wall and
 * `openDelta` (±π/2) swings it into the side recorded on the plan.
 */
export interface LeafPose {
  hinge: Vec2;
  width: number;
  /** Rotation about +Y when closed. */
  closedAngle: number;
  /** Added rotation when fully open. */
  openDelta: number;
  /** Max open fraction (bifold leaves only fold part-way). */
  maxOpen: number;
}

const angleOf = (dir: Vec2): number => Math.atan2(-dir.z, dir.x);

function leaf(hinge: Vec2, towards: Vec2, width: number, swingDir: Vec2, maxOpen = 1): LeafPose {
  const closedAngle = angleOf(towards);
  // rotateY(v, +π/2) = (v.z, −v.x); pick the sign that turns the leaf into the swing side.
  const plus = rotateY(towards, Math.PI / 2);
  const openDelta = plus.x * swingDir.x + plus.z * swingDir.z > 0 ? Math.PI / 2 : -Math.PI / 2;
  return { hinge, width, closedAngle, openDelta, maxOpen };
}

export function doorLeafPoses(door: Door, wall: Wall): LeafPose[] {
  const d = wallDirection(wall);
  const swingDir = scale(wallNormal(wall), door.swingSide);
  const start = pointAlongWall(wall, door.offset - door.width / 2);
  const end = pointAlongWall(wall, door.offset + door.width / 2);
  const back = scale(d, -1);
  switch (door.kind) {
    case 'hinged':
      return door.hinge === 'start'
        ? [leaf(start, d, door.width, swingDir)]
        : [leaf(end, back, door.width, swingDir)];
    case 'double':
      return [leaf(start, d, door.width / 2, swingDir), leaf(end, back, door.width / 2, swingDir)];
    case 'bifold':
      return door.hinge === 'start'
        ? [leaf(start, d, door.width / 2, swingDir, 0.6)]
        : [leaf(end, back, door.width / 2, swingDir, 0.6)];
    case 'sliding':
    case 'opening':
      return [];
  }
}

/** Point where the free edge of a leaf ends up at a given open fraction (used by tests/debug). */
export function leafTip(pose: LeafPose, openFraction: number): Vec2 {
  const angle = pose.closedAngle + pose.openDelta * Math.min(openFraction, pose.maxOpen);
  const dir = { x: Math.cos(angle), z: -Math.sin(angle) };
  return { x: pose.hinge.x + dir.x * pose.width, z: pose.hinge.z + dir.z * pose.width };
}
