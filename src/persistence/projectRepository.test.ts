import { describe, expect, it } from 'vitest';
import { applyCommand } from '../editor/commands';
import { e2 } from '../test/fixtures';
import { LocalStorageProjectRepository } from './projectRepository';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('LocalStorageProjectRepository', () => {
  it('saves, lists and reloads a project with its edits', async () => {
    const repo = new LocalStorageProjectRepository(memoryStorage());
    const apt = applyCommand(e2(), {
      type: 'room/renovate',
      roomId: 'hall',
      patch: { floorMaterialId: 'floor-stone' },
    });
    const meta = await repo.save(apt);
    expect((await repo.list()).map((m) => m.id)).toEqual([meta.id]);
    const loaded = await repo.load(meta.id);
    expect(loaded).toEqual(apt);
    await repo.save(apt);
    expect(await repo.list()).toHaveLength(1);
  });

  it('fails clearly for unknown projects', async () => {
    await expect(new LocalStorageProjectRepository(memoryStorage()).load('missing')).rejects.toThrow(
      /No saved project/,
    );
  });
});
