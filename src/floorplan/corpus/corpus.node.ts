import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadImageFile } from '../cv/loadImage.node';
import type { RgbaImage } from '../cv/raster';
import { synthesiseImage, type CorpusFixture } from './corpus';

/** Node-only corpus access (tests and scripts). */
export const CORPUS_ROOT = resolve(import.meta.dirname, '../../../tests/fixtures/floorplans');
export const CORPUS_CACHE = join(CORPUS_ROOT, '.cache');
const REPO_ROOT = resolve(CORPUS_ROOT, '../../..');

export function loadCorpus(root = CORPUS_ROOT): CorpusFixture[] {
  const out: CorpusFixture[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === 'fixture.json') out.push(JSON.parse(readFileSync(p, 'utf-8')) as CorpusFixture);
    }
  };
  walk(root);
  const order: Record<CorpusFixture['category'], number> = {
    e2: 0,
    synthetic: 1,
    pathological: 2,
    'real-world': 3,
  };
  return out.sort((a, b) => order[a.category] - order[b.category] || a.id.localeCompare(b.id));
}

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** The fixture's image, or null when a cached real-world image has not been fetched. */
export function loadFixtureImage(f: CorpusFixture, all: CorpusFixture[] = loadCorpus()): RgbaImage | null {
  if ('path' in f.image) return loadImageFile(resolve(REPO_ROOT, f.image.path));
  if ('cache' in f.image) {
    const p = join(CORPUS_CACHE, f.image.cache);
    if (!existsSync(p)) return null;
    const actual = sha256(readFileSync(p));
    if (actual !== f.image.sha256)
      throw new Error(`${f.id}: cached image checksum mismatch (${actual}); re-run the fetch script.`);
    return loadImageFile(p);
  }
  return synthesiseImage(f, (id) => {
    const base = all.find((x) => x.id === id);
    return base ? loadFixtureImage(base, all) : null;
  });
}
