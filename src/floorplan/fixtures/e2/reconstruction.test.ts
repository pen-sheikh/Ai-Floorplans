import { describe, expect, it } from 'vitest';
import { pointAlongWall, pointStrictlyInPolygon, wallLength } from '../../../domain/geometry';
import { roomMetrics } from '../../../domain/topology';
import { validateApartment } from '../../../domain/validation';
import { e2, e2Floor, room } from '../../../test/fixtures';
import { E2_ANNOTATIONS } from './annotations';
import { reconstructApartment, ReconstructionError } from '../../reconstruct';

describe('E2 floor plan → apartment model', () => {
  const apt = e2();
  const floor = apt.floors[0]!;

  it('produces a valid model', () => {
    const v = validateApartment(apt);
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('contains exactly the labelled rooms, plus unlabelled cupboards flagged as inferred', () => {
    const labelled = floor.rooms.filter((r) => r.labelSource === 'plan-label').map((r) => r.planLabel?.text);
    expect(labelled.sort()).toEqual([
      'Balcony',
      'Bathroom',
      'Bedroom',
      'Bedroom',
      'Hall',
      'Kitchen/Lounge/Diner',
    ]);
    const inferred = floor.rooms.filter((r) => r.labelSource !== 'plan-label');
    expect(inferred.length).toBe(4);
    expect(inferred.every((r) => r.type === 'storage')).toBe(true);
    // No stairs, columns or shafts are drawn on this plan.
    expect(floor.stairs).toEqual([]);
    expect(floor.fixtures.some((f) => f.kind === 'column' || f.kind === 'shaft')).toBe(false);
  });

  it('matches printed room dimensions within 1 % (except the inconsistent Bedroom 2 width)', () => {
    const cases: [string, number, number][] = [
      ['bedroom-1', 2.66, 3.84],
      ['bathroom', 2.31, 1.7],
      ['kitchen-living', 3.77, 6.39],
    ];
    for (const [id, w, d] of cases) {
      const m = roomMetrics(room(floor, id));
      expect(Math.abs(m.width - w) / w).toBeLessThan(0.01);
      expect(Math.abs(m.depth - d) / d).toBeLessThan(0.01);
    }
    // Bedroom 2: depth matches the label; drawn width is ≈2.82 m, not the printed 2.61 m.
    const b2 = roomMetrics(room(floor, 'bedroom-2'));
    expect(b2.width).toBeGreaterThan(2.78);
    expect(b2.width).toBeLessThan(2.86);
    expect(
      apt.metadata.notes.some((n) => n.code === 'dimension-label-mismatch' && n.entityId === 'bedroom-2'),
    ).toBe(true);
  });

  it('keeps non-rectangular geometry: L-shaped Bedroom 2 and the nib notch in the open-plan room', () => {
    expect(room(floor, 'bedroom-2').polygon).toHaveLength(6);
    const k = room(floor, 'kitchen-living');
    expect(k.polygon).toHaveLength(8);
    const nib = floor.walls.find((w) => w.id === 'w-nib-kitchen')!;
    expect(pointStrictlyInPolygon(pointAlongWall(nib, wallLength(nib) / 2), k.polygon)).toBe(false);
  });

  it('measures wall thickness from the drawing (external ≈0.20 m, partitions ≈0.10 m)', () => {
    for (const w of floor.walls) {
      if (w.kind === 'exterior') expect(w.thickness).toBeCloseTo(0.204, 2);
      if (w.kind === 'interior' && w.id.startsWith('w-int')) expect(w.thickness).toBeCloseTo(0.102, 2);
    }
  });

  it('cross-checks the total area against the printed 57.4 m²', () => {
    const note = apt.metadata.notes.find((n) => n.code === 'area-cross-check')!;
    expect(note.severity).toBe('info');
    const total = floor.rooms.filter((r) => !r.exterior).reduce((a, r) => a + roomMetrics(r).area, 0);
    // Room floor areas exclude wall footprints, so they sit just below the gross figure.
    expect(total).toBeGreaterThan(55);
    expect(total).toBeLessThan(57.4);
  });

  it('connects rooms through doors as drawn', () => {
    const connects = (id: string) => [...floor.doors.find((d) => d.id === id)!.connects].sort();
    expect(connects('d-bed1')).toEqual(['bedroom-1', 'hall']);
    expect(connects('d-bed2')).toEqual(['bedroom-2', 'hall']);
    expect(connects('d-bathroom')).toEqual(['bathroom', 'hall']);
    expect(connects('d-kitchen')).toEqual(['hall', 'kitchen-living']);
    expect(connects('d-balcony')).toEqual(['balcony', 'kitchen-living']);
    expect(connects('d-wardrobe')).toEqual(['bedroom-2', 'wardrobe-bed2']);
    expect(floor.doors.find((d) => d.id === 'd-front')!.connects).toContain(null);
    for (const r of floor.rooms) expect(r.doorIds.length).toBeGreaterThan(0);
  });

  it('records door swing sides from the plan arcs', () => {
    const swingRoom = (id: string) => {
      const d = floor.doors.find((x) => x.id === id)!;
      return d.connects[d.swingSide === 1 ? 1 : 0];
    };
    expect(swingRoom('d-bed1')).toBe('bedroom-1');
    expect(swingRoom('d-bed2')).toBe('bedroom-2');
    expect(swingRoom('d-bathroom')).toBe('hall');
    expect(swingRoom('d-cupboard-c')).toBe('hall');
    expect(swingRoom('d-balcony')).toBe('balcony');
    expect(swingRoom('d-front')).toBe('hall');
  });

  it('places windows on exterior walls with the rooms they light', () => {
    for (const w of floor.windows) {
      expect(floor.walls.find((x) => x.id === w.wallId)!.kind).toBe('exterior');
    }
    expect(room(floor, 'bedroom-1').windowIds).toEqual(['win-bed1']);
    expect([...room(floor, 'kitchen-living').windowIds].sort()).toEqual([
      'win-kitchen-east',
      'win-kitchen-north',
    ]);
  });

  it('marks assumed values as assumptions, not facts', () => {
    const ids = apt.metadata.assumptions.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['ceiling-height', 'door-height', 'window-heights']));
    expect(apt.metadata.assumptions.every((a) => a.source === 'assumed')).toBe(true);
  });

  it('derives north from the compass', () => {
    const n = apt.coordinateSystem.north!;
    expect(Math.hypot(n.x, n.z)).toBeCloseTo(1);
    expect(n.x).toBeGreaterThan(0.8);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(e2())).toEqual(JSON.stringify(apt));
  });

  it('honours a manual scale and flags it', () => {
    const manual = reconstructApartment(E2_ANNOTATIONS, { pixelsPerMeter: 100 });
    expect(manual.coordinateSystem.plan!.calibration.method).toBe('manual');
    expect(manual.metadata.notes.some((n) => n.code === 'scale-manual')).toBe(true);
    expect(roomMetrics(manual.floors[0]!.rooms[0]!).area).toBeLessThan(roomMetrics(e2Floor().rooms[0]!).area);
  });

  it('rejects openings that reference unknown walls or lie outside them', () => {
    const bad = { ...E2_ANNOTATIONS, doors: [{ ...E2_ANNOTATIONS.doors[0]!, wallId: 'nope' }] };
    expect(() => reconstructApartment(bad)).toThrow(ReconstructionError);
    const outside = {
      ...E2_ANNOTATIONS,
      doors: [{ ...E2_ANNOTATIONS.doors[0]!, span: [100, 160] as [number, number] }],
    };
    expect(() => reconstructApartment(outside)).toThrow(/outside wall/);
  });
});
