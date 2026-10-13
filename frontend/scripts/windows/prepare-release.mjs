// Sign verified native candidates on the release host. Never builds, installs,
// publishes, changes versions, uploads a key, or modifies the stable channel.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, lstatSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir, platform } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { newerVersion, validateCandidate, mergeWindowsManifest } from './release-record.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const frontend = join(root, 'frontend');
if (platform() !== 'darwin') throw new Error('Prepare updater signatures on the protected macOS release host');
const argv = process.argv.slice(2);
const value = flag => {
  const at = argv.indexOf(flag);
  if (at < 0 || !argv[at + 1] || argv[at + 1].startsWith('--')) throw new Error(`Missing ${flag}`);
  return argv[at + 1];
};
const run = (program, args, options = {}) => {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${program} failed; no release was published`);
  return result.stdout.trim();
};
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const config = json(join(frontend, 'src-tauri/tauri.conf.json'));
const version = config.version;
const packageVersion = json(join(frontend, 'package.json')).version;
const rustVersion = readFileSync(join(frontend, 'src-tauri/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const lockVersion = readFileSync(join(root, 'Cargo.lock'), 'utf8').match(/\[\[package\]\]\s+name = "tetro"\s+version = "([^"]+)"/)?.[1];
if ([packageVersion, rustVersion, lockVersion].some(v => v !== version)) throw new Error('Synchronize all four app versions first');
if (!argv.includes('--allow-unsigned-windows')) throw new Error('Explicit --allow-unsigned-windows is required until Authenticode signing is configured');
if (run('git', ['remote', 'get-url', 'origin']) !== 'https://github.com/VanaLabs/tetro.git') throw new Error('Unexpected release destination');
if (run('git', ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Release source must have no tracked changes');
const source = value('--source');
if (run('git', ['rev-parse', 'HEAD']) !== source) throw new Error('Candidate source must match the checkout');
const latest = JSON.parse(run('gh', ['release', 'view', '--repo', 'VanaLabs/tetro', '--json', 'tagName'])).tagName;
if (!newerVersion(version, latest)) throw new Error('Choose an unpublished version newer than the latest release; published bytes are immutable');

const basePath = resolve(value('--mac-manifest'));
const base = json(basePath);
const notes = readFileSync(resolve(value('--notes')), 'utf8');
const candidates = [
  ['x86_64-pc-windows-msvc', resolve(value('--x64'))],
  ['aarch64-pc-windows-msvc', resolve(value('--arm64'))],
].map(([target, directory]) => {
  const record = json(join(directory, 'build-record.json'));
  const expectedName = `Tetro_${version}_${target.startsWith('x86_64') ? 'x64' : 'arm64'}-setup.exe`;
  if (record.Installer?.Name !== expectedName) throw new Error('Unexpected consumer installer filename');
  const installer = join(directory, expectedName);
  if (!lstatSync(installer).isFile()) throw new Error('Candidate installer must be a regular file without links');
  const key = validateCandidate(record, readFileSync(installer), { source, target, version });
  return { key, installer, record };
});
const output = join(root, 'target/releases', `v${version}`, 'combined');
if (existsSync(output)) throw new Error('Release output already exists; preserve it and review before preparing again');
// Validate all new-release URLs before using their filenames as local paths.
const prefix = `https://github.com/VanaLabs/tetro/releases/download/v${version}/`;
const placeholder = Object.fromEntries(candidates.map(c => [c.key, { signature: 'pending', url: prefix + c.record.Installer.Name }]));
mergeWindowsManifest(base, { version, notes, platforms: placeholder, publishedAt: new Date().toISOString() });

const scratch = mkdtempSync(join(tmpdir(), 'tetro-release-signatures-'));
try {
  const publicKey = join(scratch, 'updater.pub');
  writeFileSync(publicKey, Buffer.from(config.plugins.updater.pubkey, 'base64'));
  const verify = (file, encoded, label) => {
    const signature = join(scratch, `${label}.minisig`);
    writeFileSync(signature, Buffer.from(encoded, 'base64'));
    run('minisign', ['-V', '-p', publicKey, '-x', signature, '-m', file]);
  };
  for (const [key, item] of Object.entries(base.platforms)) {
    verify(join(dirname(basePath), basename(item.url)), item.signature, key);
  }
  const signerEnv = { ...process.env };
  const key = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || process.env.TAURI_SIGNING_PRIVATE_KEY || join(homedir(), '.config/tetro/release/updater.key');
  if (existsSync(key)) {
    delete signerEnv.TAURI_SIGNING_PRIVATE_KEY;
    signerEnv.TAURI_SIGNING_PRIVATE_KEY_PATH = key;
  } else if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error('Restore the original updater key; do not generate a replacement');
  }
  if (signerEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
    if (platform() !== 'darwin') throw new Error('Original updater password is required through protected storage');
    const saved = spawnSync('/usr/bin/security', ['find-generic-password', '-s', 'am.vanalabs.tetro.release', '-a', 'updater-key-password', '-w'], { encoding: 'utf8' });
    if (saved.status !== 0) throw new Error('Original updater password is unavailable in Keychain');
    signerEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = saved.stdout.replace(/\r?\n$/, '');
  }
  const windows = {};
  for (const candidate of candidates) {
    // Signing touches only a disposable copy, keeping the CI candidate immutable.
    const copy = join(scratch, candidate.record.Installer.Name);
    copyFileSync(candidate.installer, copy);
    run('pnpm', ['--dir', frontend, 'exec', 'tauri', 'signer', 'sign', copy], { env: signerEnv });
    const signature = readFileSync(`${copy}.sig`, 'utf8').trim();
    verify(copy, signature, candidate.key);
    const altered = join(scratch, `${candidate.key}-changed.exe`);
    const bytes = readFileSync(copy); bytes[bytes.length - 1] ^= 1; writeFileSync(altered, bytes);
    const tampered = spawnSync('minisign', ['-V', '-p', publicKey, '-x', join(scratch, `${candidate.key}.minisig`), '-m', altered], { encoding: 'utf8' });
    if (tampered.status === 0 || !/verification failed/i.test(`${tampered.stdout}${tampered.stderr}`)) throw new Error('Modified installer rejection could not be verified');
    windows[candidate.key] = { signature, url: prefix + candidate.record.Installer.Name };
  }
  const manifest = mergeWindowsManifest(base, { version, notes, platforms: windows, publishedAt: new Date().toISOString() });
  mkdirSync(output, { recursive: true });
  for (const item of Object.values(base.platforms)) copyFileSync(join(dirname(basePath), basename(item.url)), join(output, basename(item.url)));
  for (const candidate of candidates) {
    copyFileSync(candidate.installer, join(output, candidate.record.Installer.Name));
    writeFileSync(join(output, `${candidate.record.Installer.Name}.sig`), windows[candidate.key].signature + '\n');
  }
  writeFileSync(join(output, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = [...Object.values(manifest.platforms).map(item => basename(item.url)), ...candidates.map(c => `${c.record.Installer.Name}.sig`), 'latest.json'];
  writeFileSync(join(output, 'SHA256SUMS'), files.map(name => `${hash(join(output, name))}  ${name}\n`).join(''));
  writeFileSync(join(output, 'release-record.json'), JSON.stringify({ source, version, latestPublished: latest, publication: 'not published', windowsAuthenticode: 'unsigned', updaterSignatures: 'original key verified; altered installers rejected', candidates: candidates.map(c => c.record) }, null, 2) + '\n');
  console.log(`Signed Windows installers and merged manifest prepared at ${output}. Nothing was published or installed.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
