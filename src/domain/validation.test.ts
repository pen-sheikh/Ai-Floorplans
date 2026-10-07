import { describe, expect, it } from 'vitest';
import { e2 } from '../test/fixtures';
import type { Apartment, Floor } from './types';
import { validateApartment } from './validation';

/** Clone the real model and apply a mutation to its only floor. */
function broken(mutate: (f: Floor) => void): Apartment {
  const apt = structuredClone(e2());
  mutate(apt.floors[0]!);
  return apt;
}

const codes = (apt: Apartment) => validateApartment(apt).issues.map((i) => i.code);

describe('apartment validation', () => {
  it('accepts the reconstructed plan', () => {
    expect(validateApartment(e2()).ok).toBe(true);
  });

  it('rejects zero-length and zero-thickness walls', () => {
    expect(codes(broken((f) => (f.walls[0]!.end = { ...f.walls[0]!.start })))).toContain('wall-zero-length');
    expect(codes(broken((f) => (f.walls[0]!.thickness = 0)))).toContain('wall-thickness');
  });

  it('rejects doors and windows without a wall', () => {
    expect(codes(broken((f) => (f.doors[0]!.wallId = 'ghost')))).toContain('door-missing-wall');
    expect(codes(broken((f) => (f.windows[0]!.wallId = 'ghost')))).toContain('window-missing-wall');
  });

  it('rejects openings that leave their wall or overlap', () => {
    expect(codes(broken((f) => (f.doors[0]!.offset = 100)))).toContain('door-outside-wall');
    expect(
      codes(
        broken((f) => {
          const d = f.doors.find((x) => x.id === 'd-bed1')!;
          f.doors.find((x) => x.id === 'd-bed2')!.offset = d.offset + 0.2;
        }),
      ),
    ).toContain('opening-overlap');
    expect(codes(broken((f) => (f.windows[0]!.sillHeight = 2.3)))).toContain('window-too-tall');
  });

  it('rejects duplicate ids', () => {
    expect(codes(broken((f) => (f.rooms[1]!.id = f.rooms[0]!.id)))).toContain('duplicate-id');
  });

  it('rejects self-intersecting, degenerate and overlapping rooms', () => {
    expect(
      codes(
        broken((f) => {
          const p = f.rooms[0]!.polygon;
          [p[1], p[2]] = [p[2]!, p[1]!];
        }),
      ),
    ).toContain('room-self-intersection');
    expect(codes(broken((f) => (f.rooms[0]!.polygon = f.rooms[0]!.polygon.slice(0, 2))))).toContain(
      'room-polygon-vertices',
    );
    expect(
      codes(broken((f) => (f.rooms[1]!.polygon = f.rooms[0]!.polygon.map((p) => ({ ...p }))))),
    ).toContain('room-overlap');
  });

  it('rejects invalid furniture and warns about furniture outside its room', () => {
    const base = {
      id: 'f1',
      catalogId: 'sofa-3',
      name: 'Sofa',
      category: 'sofa' as const,
      roomId: 'kitchen-living',
      position: { x: 7, z: 3 },
      elevation: 0,
      rotation: 0,
      dimensions: { width: 2.2, depth: 0.9, height: 0.85 },
      materialId: 'fabric-linen',
    };
    expect(
      codes(broken((f) => f.furniture.push({ ...base, dimensions: { width: -1, depth: 1, height: 1 } }))),
    ).toContain('furniture-dimensions');
    expect(codes(broken((f) => f.furniture.push({ ...base, roomId: 'nowhere' })))).toContain(
      'furniture-missing-room',
    );
    const outside = validateApartment(broken((f) => f.furniture.push({ ...base, position: { x: 0, z: 0 } })));
    expect(outside.ok).toBe(true);
    expect(outside.issues.find((i) => i.code === 'furniture-outside-room')?.severity).toBe('warning');
  });

  it('rejects unsupported schema versions', () => {
    const apt = { ...e2(), schemaVersion: 99 } as unknown as Apartment;
    expect(codes(apt)).toContain('schema-version');
  });
});
