import { deserializeProject, serializeProject } from '../domain/serialization';
import type { Apartment } from '../domain/types';
import type { ValidationContext } from '../domain/validation';

export interface SavedProjectMeta {
  id: string;
  name: string;
  savedAt: string;
}

/**
 * Storage boundary for apartment projects. The browser implementation uses localStorage;
 * a backend (property listings, user accounts) can implement the same interface.
 */
export interface ProjectRepository {
  save(apartment: Apartment): Promise<SavedProjectMeta>;
  load(id: string): Promise<Apartment>;
  list(): Promise<SavedProjectMeta[]>;
}

const INDEX_KEY = 'ai-floorplans:projects';
const projectKey = (id: string) => `ai-floorplans:project:${id}`;

export class LocalStorageProjectRepository implements ProjectRepository {
  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
    private readonly validation: ValidationContext = {},
  ) {}

  async list(): Promise<SavedProjectMeta[]> {
    try {
      const raw = this.storage.getItem(INDEX_KEY);
      return raw ? (JSON.parse(raw) as SavedProjectMeta[]) : [];
    } catch {
      return [];
    }
  }

  async save(apartment: Apartment): Promise<SavedProjectMeta> {
    const meta: SavedProjectMeta = {
      id: apartment.id,
      name: apartment.metadata.name,
      savedAt: new Date().toISOString(),
    };
    this.storage.setItem(projectKey(apartment.id), serializeProject(apartment));
    const index = (await this.list()).filter((m) => m.id !== meta.id);
    this.storage.setItem(INDEX_KEY, JSON.stringify([meta, ...index]));
    return meta;
  }

  async load(id: string): Promise<Apartment> {
    const raw = this.storage.getItem(projectKey(id));
    if (!raw) throw new Error(`No saved project "${id}".`);
    return deserializeProject(raw, undefined, this.validation).apartment;
  }
}

/** Trigger a browser download of the project JSON. */
export function downloadProject(apartment: Apartment): void {
  const blob = new Blob([serializeProject(apartment)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${apartment.id}.apartment.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
