import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Bun module mocks are process-global. Keep unrelated component fixtures isolated.
function discover(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? discover(path) : /\.test\.(tsx?|mjs)$/.test(path) ? [path] : [];
  });
}
const files = [...discover('tests'), ...discover('src')].sort();
// npm's Windows .cmd shim cannot be launched by spawnSync without a shell.
// Bun's pinned package installs its real executable at this path on every OS.
const require = createRequire(import.meta.url);
const bun = process.env.BUN_BIN || join(dirname(require.resolve('bun/package.json')), 'bin', 'bun.exe');
let failed = 0;
for (const file of files) {
  const result = spawnSync(bun, ['test', `./${file}`], { stdio: 'inherit', timeout: 60_000 });
  if (result.error) console.error(`${file}: ${result.error.message}`);
  if (result.status !== 0) failed++;
}
console.log(`${files.length - failed}/${files.length} test files passed in isolated processes.`);
process.exitCode = failed ? 1 : 0;
