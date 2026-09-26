import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Bun module mocks are process-global. Keep unrelated component fixtures isolated.
function discover(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? discover(path) : /\.test\.(tsx?|mjs)$/.test(path) ? [path] : [];
  });
}
const files = [...discover('tests'), ...discover('src')].sort();
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.env.BUN_BIN || 'bun', ['test', `./${file}`], { stdio: 'inherit', timeout: 60_000 });
  if (result.error) console.error(`${file}: ${result.error.message}`);
  if (result.status !== 0) failed++;
}
console.log(`${files.length - failed}/${files.length} test files passed in isolated processes.`);
process.exitCode = failed ? 1 : 0;
