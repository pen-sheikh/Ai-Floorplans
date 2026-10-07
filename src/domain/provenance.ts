import type { Provenance } from './types';
import { formatLength } from './units';

/** How a provenance is presented to people: the four categories plus user edits. */
export type ProvenanceClass = 'known' | 'measured' | 'estimated' | 'inferred' | 'assumed' | 'user';

export const PROVENANCE_CLASS: Record<Provenance, ProvenanceClass> = {
  'plan-label': 'known',
  'plan-geometry': 'measured',
  detected: 'estimated',
  estimated: 'estimated',
  inferred: 'inferred',
  assumed: 'assumed',
  user: 'user',
};

export const PROVENANCE_HELP: Record<ProvenanceClass, string> = {
  known: 'Printed on the plan',
  measured: 'Measured from the drawing at the calibrated scale',
  estimated: 'Estimated (automatic detection or uncalibrated scale)',
  inferred: 'Inferred from drawing conventions',
  assumed: 'Not on the plan — a documented default',
  user: 'Entered by a user',
};

/** "≈ 2.40 m (assumed)" — value with its provenance, never false precision. */
export function formatMeasured(meters: number, source: Provenance): string {
  const cls = PROVENANCE_CLASS[source];
  const suffix = cls === 'measured' || cls === 'known' || cls === 'user' ? '' : ` (${cls})`;
  return `${formatLength(meters, source)}${suffix}`;
}

export const formatConfidence = (c: number | undefined): string =>
  c === undefined ? 'not assessed' : `${Math.round(c * 100)} %`;
