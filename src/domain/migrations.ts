import type { Provenance } from './types';

/**
 * Schema migrations. Each takes a raw (untyped) apartment document at version N and returns
 * version N + 1. They operate on plain JSON so old files never have to type-check.
 */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

type Json = Record<string, unknown>;
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const prov = (v: unknown, fallback: Provenance): Provenance =>
  typeof v === 'string' ? (v as Provenance) : fallback;

/**
 * v1 → v2: per-field provenance.
 *
 * v1 had one `source` per wall/door/window/fixture describing its *geometry*; every height in
 * a v1 file came from reconstruction defaults, so heights become 'assumed'. Calibration gains
 * a confidence grade and samples are keyed by reference id.
 */
export function migrateV1ToV2(doc: Json): Json {
  const floors = list(doc.floors).map((f) => ({
    ...f,
    heightSource: 'assumed',
    walls: list(f.walls).map(({ source, ...w }) => ({
      ...w,
      sources: { geometry: prov(source, 'plan-geometry'), height: 'assumed' },
    })),
    doors: list(f.doors).map(({ source, ...d }) => ({
      ...d,
      sources: {
        geometry: prov(source, 'plan-geometry'),
        height: 'assumed',
        swing: d.kind === 'opening' ? 'inferred' : prov(source, 'plan-geometry'),
      },
    })),
    windows: list(f.windows).map(({ source, ...w }) => ({
      ...w,
      sources: { geometry: prov(source, 'plan-geometry'), sillHeight: 'assumed', height: 'assumed' },
    })),
    rooms: list(f.rooms).map((r) => ({
      ...r,
      sources: { geometry: 'plan-geometry', ceilingHeight: 'assumed' },
    })),
    fixtures: list(f.fixtures).map(({ source, ...x }) => ({
      ...x,
      sources: { footprint: prov(source, 'plan-geometry'), height: 'assumed' },
    })),
  }));

  const cs = (doc.coordinateSystem ?? {}) as Json;
  const plan = cs.plan as Json | undefined;
  let coordinateSystem = cs;
  if (plan?.calibration) {
    const cal = plan.calibration as Json;
    const samples: Json[] = list(cal.samples).map((s, i) => ({
      referenceId: `${String(s.roomId ?? 'ref')}#${i}`,
      ...s,
    }));
    const accepted = samples.filter((s) => s.accepted).length;
    const spread = typeof cal.maxResidual === 'number' ? cal.maxResidual : 1;
    const confidence =
      cal.method === 'manual'
        ? 'low'
        : accepted >= 3 && spread <= 0.02
          ? 'high'
          : accepted >= 2 && spread <= 0.05
            ? 'medium'
            : 'low';
    coordinateSystem = { ...cs, plan: { ...plan, calibration: { ...cal, samples, confidence } } };
  }

  const metadata = { ...((doc.metadata ?? {}) as Json) };
  if (!metadata.annotationSource) metadata.annotationSource = { method: 'manual' };
  return { ...doc, floors, coordinateSystem, metadata };
}

/** Registry keyed by the version a migration upgrades FROM. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: migrateV1ToV2,
};
