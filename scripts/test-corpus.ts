/**
 * Run the whole floor-plan corpus (E2, synthetic, pathological and the real-world plans in the
 * local cache) and write tests/fixtures/floorplans/REPORT.md.  `npm run test:corpus`
 */
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', 'src/floorplan/corpus', '--silent=false'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CORPUS: '1' },
});
process.exit(r.status ?? 1);
