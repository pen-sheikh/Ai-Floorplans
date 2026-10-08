/**
 * Download the real-world corpus images into tests/fixtures/floorplans/.cache (git-ignored).
 * Each fixture.json names its source page, licence, download URL and SHA-256; files are
 * verified after download. Nothing is committed; the repository does not depend on them.
 *
 *   node scripts/fetch-corpus.ts            (Node ≥ 23 runs TypeScript directly)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../tests/fixtures/floorplans');
const cache = join(root, '.cache');
const USER_AGENT = 'ai-floorplans-corpus/1.0 (floor-plan extraction test corpus)';

interface Fixture {
  id: string;
  image: { cache?: string; url?: string; sha256?: string };
  source?: { license?: string; page?: string };
}

function fixtures(dir: string): Fixture[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name.startsWith('.')) return [];
    if (statSync(p).isDirectory()) return fixtures(p);
    return name === 'fixture.json' ? [JSON.parse(readFileSync(p, 'utf-8')) as Fixture] : [];
  });
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function download(url: string): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    if (res.status !== 429 || attempt >= 6) throw new Error(`HTTP ${res.status} for ${url}`);
    await sleep(15_000 * attempt); // the host rate-limits bulk downloads
  }
}

mkdirSync(cache, { recursive: true });
let failed = 0;
for (const f of fixtures(root).filter((x) => x.image.cache && x.image.url)) {
  const target = join(cache, f.image.cache!);
  if (existsSync(target) && sha256(readFileSync(target)) === f.image.sha256) {
    console.log(`ok       ${f.id}`);
    continue;
  }
  try {
    const data = await download(f.image.url!);
    const actual = sha256(data);
    if (actual !== f.image.sha256) throw new Error(`checksum ${actual} does not match the fixture`);
    writeFileSync(target, data);
    console.log(`fetched  ${f.id}  (${f.source?.license ?? 'licence?'}; ${f.source?.page ?? ''})`);
    await sleep(3000);
  } catch (e) {
    failed++;
    console.error(`FAILED   ${f.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
process.exitCode = failed ? 1 : 0;
