import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../editor/commands';
import { e2 } from '../test/fixtures';
import {
  deserializeProject,
  migrateDocument,
  PROJECT_FORMAT,
  ProjectLoadError,
  serializeProject,
} from './serialization';
import { SCHEMA_VERSION } from './types';

describe('project serialization', () => {
  it('round-trips geometry, furniture and renovation exactly', () => {
    let apt = e2();
    apt = applyCommand(apt, {
      type: 'furniture/add',
      item: {
        id: 'sofa-1',
        catalogId: 'sofa-3',
        name: '3-seat sofa',
        category: 'sofa',
        roomId: 'kitchen-living',
        position: { x: 8.5, z: 4.2 },
        elevation: 0,
        rotation: Math.PI / 2,
        dimensions: { width: 2.2, depth: 0.9, height: 0.85 },
        materialId: 'fabric-sky',
      },
    });
    apt = applyCommand(apt, {
      type: 'room/renovate',
      roomId: 'bedroom-1',
      patch: { floorMaterialId: 'floor-walnut', wallColor: '#aabbcc' },
    });

    const json = serializeProject(apt, new Date('2026-01-01T00:00:00Z'));
    const parsed = JSON.parse(json);
    expect(parsed).toMatchObject({
      format: PROJECT_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      savedAt: '2026-01-01T00:00:00.000Z',
    });

    const { apartment } = deserializeProject(json);
    expect(apartment).toEqual(apt);
    expect(apartment.floors[0]!.furniture[0]!.rotation).toBe(Math.PI / 2);
    expect(apartment.floors[0]!.rooms.find((r) => r.id === 'bedroom-1')!.renovation.wallColor).toBe(
      '#aabbcc',
    );
  });

  it('runs migrations in order up to the current version', () => {
    const migrations = {
      0: (d: Record<string, unknown>) => ({ ...d, renamed: d.old, old: undefined }),
    };
    const out = migrateDocument({ schemaVersion: 0, old: 'x' }, migrations, 1);
    expect(out).toMatchObject({ schemaVersion: 1, renamed: 'x' });
    expect(() => migrateDocument({ schemaVersion: 0 }, {}, 1)).toThrow(/No migration/);
    expect(() => migrateDocument({ schemaVersion: 5 }, {}, 1)).toThrow(/newer/);
  });

  it('refuses invalid input with a clear error', () => {
    expect(() => deserializeProject('not json')).toThrow(ProjectLoadError);
    expect(() => deserializeProject(JSON.stringify({ format: 'other' }))).toThrow(/format/);
    const bad = JSON.parse(serializeProject(e2()));
    bad.apartment.floors[0].walls[0].thickness = -1;
    try {
      deserializeProject(JSON.stringify(bad));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectLoadError);
      expect((e as ProjectLoadError).issues.some((i) => i.code === 'wall-thickness')).toBe(true);
    }
  });
});

describe('v1 → v2 migration (real v1 save file)', () => {
  const v1 = readFileSync(resolve(__dirname, '__fixtures__/project-v1.json'), 'utf8');

  it('loads a project saved by the v1 app and upgrades it', () => {
    expect(JSON.parse(v1).schemaVersion).toBe(1);
    const { apartment, migratedFrom } = deserializeProject(v1);
    expect(migratedFrom).toBe(1);
    expect(apartment.schemaVersion).toBe(SCHEMA_VERSION);
    const f = apartment.floors[0]!;
    // Geometry provenance kept; heights — always defaults in v1 — become explicit assumptions.
    expect(f.walls[0]!.sources).toEqual({ geometry: 'plan-geometry', height: 'assumed' });
    expect(f.windows[0]!.sources).toEqual({
      geometry: 'plan-geometry',
      sillHeight: 'assumed',
      height: 'assumed',
    });
    expect(f.rooms[0]!.sources).toEqual({ geometry: 'plan-geometry', ceilingHeight: 'assumed' });
    expect(f.fixtures.find((x) => x.id === 'fx-builtin-kitchen')!.sources.footprint).toBe('inferred');
    expect(f.heightSource).toBe('assumed');
    expect(apartment.coordinateSystem.plan!.calibration.confidence).toBe('high');
    expect(f.walls.some((w) => 'source' in w)).toBe(false);
  });

  it('preserves user edits (furniture, renovation) through migration', () => {
    const f = deserializeProject(v1).apartment.floors[0]!;
    expect(f.furniture).toHaveLength(1);
    expect(f.furniture[0]).toMatchObject({ id: 'furniture-v1-sofa', rotation: -Math.PI / 2 });
    expect(f.rooms.find((r) => r.id === 'bedroom-1')!.renovation).toMatchObject({
      floorMaterialId: 'floor-walnut',
      wallColor: '#e3d5bf',
    });
  });

  it('migrated v1 geometry equals a fresh v2 reconstruction', () => {
    const migrated = deserializeProject(v1).apartment.floors[0]!;
    const fresh = e2().floors[0]!;
    expect(migrated.walls).toEqual(fresh.walls);
    expect(migrated.doors).toEqual(fresh.doors);
    expect(migrated.rooms.map((r) => r.polygon)).toEqual(fresh.rooms.map((r) => r.polygon));
  });
});
