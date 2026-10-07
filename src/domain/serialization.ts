import { MIGRATIONS, type Migration } from './migrations';
import { SCHEMA_VERSION, type Apartment } from './types';
import { validateApartment, type ValidationContext, type ValidationIssue } from './validation';

export { MIGRATIONS, type Migration } from './migrations';

export const PROJECT_FORMAT = 'ai-floorplans/apartment-project';

/** On-disk envelope. `schemaVersion` versions the apartment model inside it. */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  savedAt: string;
  apartment: Apartment;
}

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
    try {
      current = step(current);
    } catch (e) {
      throw new ProjectLoadError(
        `Migration from schema v${version} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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
  ctx: ValidationContext = {},
): { apartment: Apartment; issues: ValidationIssue[]; migratedFrom?: number } {
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
    result = validateApartment(apartment, ctx);
  } catch {
    throw new ProjectLoadError('Project structure is malformed.');
  }
  if (!result.ok) throw new ProjectLoadError('Project failed validation.', result.issues);
  const from = typeof file.schemaVersion === 'number' ? file.schemaVersion : SCHEMA_VERSION;
  return { apartment, issues: result.issues, ...(from < SCHEMA_VERSION ? { migratedFrom: from } : {}) };
}
