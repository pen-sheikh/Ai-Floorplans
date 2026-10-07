import { pointAlongWall, wallDirection, wallLength } from '../../domain/geometry';
import type { Door, Wall, Window } from '../../domain/types';

/**
 * Pure wall-mesh builder. A wall with openings is decomposed into axis-aligned boxes
 * (full-height solids between openings, sills below windows, lintels above openings), so
 * no CSG is needed and the output is easy to test.
 */

export interface WallOpeningSpan {
  id: string;
  /** Distance along the wall, metres. */
  from: number;
  to: number;
  /** Height of the opening's bottom and top above the floor. */
  bottom: number;
  top: number;
}

export type WallPieceKind = 'solid' | 'sill' | 'lintel';

export interface WallPiece {
  kind: WallPieceKind;
  from: number;
  to: number;
  bottom: number;
  top: number;
}

export interface BoxTransform {
  center: { x: number; y: number; z: number };
  /** Box extents: length along the wall, height, thickness across it. */
  size: { length: number; height: number; thickness: number };
  /** Rotation about +Y so that local +X runs along the wall and local +Z along its normal. */
  rotationY: number;
}

const MIN_PIECE = 1e-3;

export function openingSpans(
  wall: Wall,
  doors: readonly Door[],
  windows: readonly Window[],
): WallOpeningSpan[] {
  return [
    ...doors
      .filter((d) => d.wallId === wall.id)
      .map((d) => ({
        id: d.id,
        from: d.offset - d.width / 2,
        to: d.offset + d.width / 2,
        bottom: 0,
        top: d.height,
      })),
    ...windows
      .filter((w) => w.wallId === wall.id)
      .map((w) => ({
        id: w.id,
        from: w.offset - w.width / 2,
        to: w.offset + w.width / 2,
        bottom: w.sillHeight,
        top: w.sillHeight + w.height,
      })),
  ];
}

export function wallPieces(wall: Wall, openings: readonly WallOpeningSpan[]): WallPiece[] {
  const length = wallLength(wall);
  const H = wall.height;
  const sorted = openings
    .map((o) => ({ ...o, from: Math.max(0, o.from), to: Math.min(length, o.to) }))
    .filter((o) => o.to - o.from > MIN_PIECE)
    .sort((a, b) => a.from - b.from);

  const pieces: WallPiece[] = [];
  let cursor = 0;
  for (const o of sorted) {
    if (o.from - cursor > MIN_PIECE)
      pieces.push({ kind: 'solid', from: cursor, to: o.from, bottom: 0, top: H });
    const from = Math.max(o.from, cursor);
    if (o.to - from > MIN_PIECE) {
      if (o.bottom > MIN_PIECE)
        pieces.push({ kind: 'sill', from, to: o.to, bottom: 0, top: Math.min(o.bottom, H) });
      if (H - o.top > MIN_PIECE) pieces.push({ kind: 'lintel', from, to: o.to, bottom: o.top, top: H });
    }
    cursor = Math.max(cursor, o.to);
  }
  if (length - cursor > MIN_PIECE)
    pieces.push({ kind: 'solid', from: cursor, to: length, bottom: 0, top: H });
  return pieces;
}

export function wallRotationY(wall: Pick<Wall, 'start' | 'end'>): number {
  const d = wallDirection(wall);
  return Math.atan2(-d.z, d.x);
}

export function pieceTransform(wall: Wall, piece: WallPiece, elevation = 0): BoxTransform {
  const mid = pointAlongWall(wall, (piece.from + piece.to) / 2);
  return {
    center: { x: mid.x, y: elevation + (piece.bottom + piece.top) / 2, z: mid.z },
    size: { length: piece.to - piece.from, height: piece.top - piece.bottom, thickness: wall.thickness },
    rotationY: wallRotationY(wall),
  };
}

/** Total solid volume of the pieces (used to sanity-check openings in tests). */
export const piecesVolume = (wall: Wall, pieces: readonly WallPiece[]): number =>
  pieces.reduce((v, p) => v + (p.to - p.from) * (p.top - p.bottom) * wall.thickness, 0);
