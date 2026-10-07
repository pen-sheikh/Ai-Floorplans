import { SCHEMA_VERSION, type Apartment } from './types';
import { validateApartment, type ValidationIssue } from './validation';

export const PROJECT_FORMAT = 'ai-floorplans/apartment-project';

/** On-disk envelope. `schemaVersion` versions the apartment model inside it. */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  savedAt: string;
  apartment: Apartment;
}

/** A migration upgrades a raw document from version N to N + 1. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registry of migrations keyed by the version they upgrade FROM. Version 1 is the first
 * published schema, so the registry is empty today; add `1: (doc) => …` when v2 lands.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export class ProjectLoadError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

export function serializeProject(apartment: Apartment, now: Date = new Date()): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    savedAt: now.toISOString(),
    apartment,
  };
  return JSON.stringify(file, null, 2);
}

/** Apply migrations in order until the document reaches `target`. */
export function migrateDocument(
  doc: Record<string, unknown>,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): Record<string, unknown> {
  let current = doc;
  let version = typeof current.schemaVersion === 'number' ? current.schemaVersion : NaN;
  if (!Number.isInteger(version)) throw new ProjectLoadError('Project has no schemaVersion.');
  if (version > target)
    throw new ProjectLoadError(`Project schema v${version} is newer than this app (v${target}).`);
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new ProjectLoadError(`No migration from schema v${version}.`);
    current = step(current);
    version += 1;
    current = { ...current, schemaVersion: version };
  }
  return current;
}

/**
 * Parse, migrate and validate a saved project. Throws `ProjectLoadError` (with validation
 * issues) rather than returning geometry that would render incorrectly.
 */
export function deserializeProject(
  json: string,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): { apartment: Apartment; issues: ValidationIssue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectLoadError('File is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object') throw new ProjectLoadError('File is not a project.');
  const file = raw as Partial<ProjectFile>;
  if (file.format !== PROJECT_FORMAT) throw new ProjectLoadError('Unrecognised project format.');
  if (!file.apartment || typeof file.apartment !== 'object')
    throw new ProjectLoadError('Project has no apartment.');

  const apartmentDoc = migrateDocument(
    { ...(file.apartment as unknown as Record<string, unknown>), schemaVersion: file.schemaVersion },
    migrations,
  );
  const apartment = apartmentDoc as unknown as Apartment;
  if (!Array.isArray(apartment.floors)) throw new ProjectLoadError('Project apartment has no floors.');
  let result: ReturnType<typeof validateApartment>;
  try {
    result = validateApartment(apartment);
  } catch {
    throw new ProjectLoadError('Project structure is malformed.');
  }
  if (!result.ok) throw new ProjectLoadError('Project failed validation.', result.issues);
  return { apartment, issues: result.issues };
}
