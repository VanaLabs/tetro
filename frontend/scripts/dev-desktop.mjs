#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { Script } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareDevelopmentBundle } from './dev-app-runner.mjs';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [path.join(os.homedir(), '.cargo/bin'), '/opt/homebrew/opt/rustup/bin', '/usr/local/opt/rustup/bin'];
const env = {
  ...process.env,
  PATH: [...candidates.filter(existsSync), process.env.PATH].join(path.delimiter),
  NEXT_PUBLIC_TETRO_DEV: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  TETRO_EXPECTED_IDENTIFIER: 'am.vanalabs.tetro.dev',
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || '6',
};
const portInUse = await new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port: 3119 });
  const finish = occupied => { socket.destroy(); resolve(occupied); };
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.setTimeout(1000, () => finish(false));
});
if (portInUse) {
  console.error('Port 3119 is already in use. Tetro Dev may already be running. Use its existing window, or stop its launcher with Control-C before starting again.');
  process.exit(1);
}
if (spawnSync('cargo', ['--version'], { env, stdio: 'ignore' }).status !== 0) {
  console.error('Rust is required to run Tetro Dev. Install Rust, then run this launcher again.');
  process.exit(1);
}
if (process.platform === 'darwin') {
  const host = spawnSync('rustc', ['-vV'], { env, encoding: 'utf8' });
  const triple = host.stdout?.match(/^host: (.+)$/m)?.[1];
  if (host.status !== 0 || !triple) throw new Error('Could not identify the Rust host target.');
  const binaries = path.join(frontend, 'src-tauri/binaries');
  const helper = path.join(binaries, `llama-helper-${triple}`);
  const ffmpeg = path.join(binaries, `ffmpeg-${triple}`);
  mkdirSync(binaries, { recursive: true });
  if (!existsSync(helper)) {
    console.log('Building the local notes-model helper for the first launch…');
    const result = spawnSync('cargo', ['build', '-p', 'llama-helper', '--features', 'metal'], { cwd: path.join(frontend, '..'), env, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Could not build llama-helper.');
    copyFileSync(path.join(frontend, '..', 'target/debug/llama-helper'), helper);
  }
  if (!existsSync(ffmpeg)) {
    console.log('Preparing the audio sidecar for the first launch…');
    const result = spawnSync('cargo', ['build', '-p', 'meetily', '--lib'], { cwd: path.join(frontend, '..'), env, stdio: 'inherit' });
    if (result.status !== 0 || !existsSync(ffmpeg)) throw new Error('Could not prepare FFmpeg.');
  }
  env.TETRO_DEV_EXECUTABLE = prepareDevelopmentBundle(frontend);
}
console.log('Starting Tetro Dev. Frontend changes update live; Rust changes rebuild and relaunch.');
console.log('Development data: am.vanalabs.tetro.dev. Quit this terminal with Control-C to stop.');

const children = new Set();
let stopping = false;
const stop = (signal = 'SIGTERM') => {
  stopping = true;
  for (const child of children) {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message);
    }
  }
};
const start = args => {
  const child = spawn(process.execPath, args, {
    cwd: frontend, env, stdio: 'inherit', detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
  return child;
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));

try {
  const web = start([path.join(frontend, 'node_modules/next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', '3119']);
  web.once('exit', code => { if (!stopping) { process.exitCode = code || 1; stop(); } });
  const origin = 'http://127.0.0.1:3119';
  const deadline = Date.now() + 120_000;
  const readReadyFile = async pathname => {
    while (!stopping && Date.now() < deadline) {
      try {
        const response = await fetch(new URL(pathname, origin), { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const source = await response.text();
        // Compile only, never execute: reject incomplete first-build JS responses.
        if (pathname.includes('/_next/') && pathname.split('?')[0].endsWith('.js')) new Script(source);
        return source;
      } catch {
        await delay(250);
      }
    }
    throw new Error(stopping ? 'Launch stopped.' : `Frontend did not become ready: ${pathname}`);
  };

  console.log('Preparing the frontend before opening the native window…');
  for (const route of ['/', '/meeting-details', '/settings', '/templates']) await readReadyFile(route);
  const html = await readReadyFile('/');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&'));
  await Promise.all([...new Set(scripts)].map(readReadyFile));
  if (!stopping) {
    console.log('Frontend ready. Opening Tetro Dev.');
    const native = start([path.join(frontend, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--config', 'src-tauri/tauri.dev.conf.json', ...process.argv.slice(2)]);
    const code = await new Promise(resolve => { native.once('exit', resolve); native.once('error', () => resolve(1)); });
    process.exitCode = code ?? 0;
  }
} catch (error) {
  if (!stopping) { console.error(error.message); process.exitCode = 1; }
} finally {
  stop();
}
