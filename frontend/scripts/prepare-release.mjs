// Build locally; never publishes, installs, or changes the release version.
import { readFileSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, arch, platform } from 'node:os';
import { spawnSync } from 'node:child_process';
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(frontend, '..');
const config = JSON.parse(readFileSync(resolve(frontend, 'src-tauri/tauri.conf.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(frontend, 'package.json'), 'utf8'));
const rust = readFileSync(resolve(frontend, 'src-tauri/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (pkg.version !== config.version || rust !== config.version) throw new Error('Synchronize package.json, Cargo.toml and tauri.conf.json versions first.');
if (platform() !== 'darwin' || !['arm64', 'x64'].includes(arch())) throw new Error('This release script supports native macOS builds only.');
const key = process.env.TAURI_SIGNING_PRIVATE_KEY || resolve(homedir(), '.config/tetro/release/updater.key');
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(key)) throw new Error('Updater signing key is missing. Restore the original release key; do not replace it.');
if (!process.env.APPLE_SIGNING_IDENTITY && !process.argv.includes('--allow-adhoc')) throw new Error('Set APPLE_SIGNING_IDENTITY to a Developer ID identity, or use --allow-adhoc for distribution without Apple notarization.');
const target = arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
let signingPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
if (signingPassword === undefined) {
  const saved = spawnSync('/usr/bin/security', ['find-generic-password', '-s', 'am.vanalabs.tetro.release', '-a', 'updater-key-password', '-w'], { encoding: 'utf8' });
  if (saved.status !== 0) throw new Error('Updater password is unavailable in Keychain. Unlock Keychain or provide TAURI_SIGNING_PRIVATE_KEY_PASSWORD.');
  signingPassword = saved.stdout.replace(/\r?\n$/, '');
  if (!signingPassword) throw new Error('The saved updater password is empty.');
}
const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: signingPassword };
if (!env.DEVELOPER_DIR && existsSync('/Applications/Xcode.app/Contents/Developer')) env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
const result = spawnSync('pnpm', ['tauri', 'build', '--ci', '--config', 'src-tauri/tauri.release.conf.json'], { cwd: frontend, env, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const bundle = resolve(root, 'target/release/bundle');
const archive = resolve(bundle, 'macos/Tetro.app.tar.gz');
const signature = readFileSync(`${archive}.sig`, 'utf8').trim();
if (!signature) throw new Error('Missing updater signature.');
const out = resolve(root, 'target/releases', `v${config.version}`, target);
mkdirSync(out, { recursive: true });
const filename = `Tetro_${config.version}_${target}.app.tar.gz`;
copyFileSync(archive, resolve(out, filename));
copyFileSync(`${archive}.sig`, resolve(out, `${filename}.sig`));
const { readdirSync } = await import('node:fs');
const dmgs = readdirSync(resolve(bundle, 'dmg')).filter(name => name.endsWith('.dmg') && name.includes(config.version));
if (dmgs.length !== 1) throw new Error('Expected exactly one DMG for this version.');
copyFileSync(resolve(bundle, 'dmg', dmgs[0]), resolve(out, basename(dmgs[0])));
const notes = process.env.TETRO_RELEASE_NOTES_FILE ? readFileSync(process.env.TETRO_RELEASE_NOTES_FILE, 'utf8') : `Tetro ${config.version}`;
const manifest = { version: config.version, notes, pub_date: new Date().toISOString(), platforms: {
  [`darwin-${arch() === 'arm64' ? 'aarch64' : 'x86_64'}`]: { signature, url: `https://github.com/VanaLabs/tetro/releases/download/v${config.version}/${filename}` }
} };
writeFileSync(resolve(out, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Release files prepared at ${out}. Nothing was published or installed.`);
