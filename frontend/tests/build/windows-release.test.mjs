import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { newerVersion, validateCandidate, mergeWindowsManifest } from '../../scripts/windows/release-record.mjs';

const source = 'a'.repeat(40), version = '9.1.8', bytes = Buffer.from('test installer');
const target = 'aarch64-pc-windows-msvc';
const options = { source, target, version };
const record = () => ({
  SourceCommit: source, Target: target, Version: version, Product: 'Tetro',
  Identity: 'am.vanalabs.tetro', Distribution: 'candidate', Publication: 'not published', WindowsMinimumBuild: 22000,
  Installer: { Name: 'Tetro_9.1.8_arm64-setup.exe', Size: bytes.length, SHA256: createHash('sha256').update(bytes).digest('hex') },
  Payloads: [{ Name: 'tetro.exe' }, { Name: `ffmpeg-${target}.exe`, SHA256: 'b'.repeat(64), Size: 1234 }],
  FfmpegEmbeddedPin: { Target: target, SHA256: 'b'.repeat(64), Size: '1234' },
});
test('release versions must advance the published series without replacing bytes', () => {
  expect(newerVersion('9.1.8', 'v9.1.7')).toBe(true);
  expect(newerVersion('9.2.0', '9.1.9')).toBe(true);
  expect(newerVersion('9.1.7', 'v9.1.7')).toBe(false);
  expect(newerVersion('9.1.6', 'v9.1.7')).toBe(false);
  expect(() => newerVersion('10.1.0', '9.1.7')).toThrow();
});
test('consumer candidate verification rejects mixed identities, sources, targets and tampering', () => {
  expect(validateCandidate(record(), bytes, options)).toBe('windows-aarch64');
  for (const change of [{ Identity: 'am.vanalabs.tetro.dev' }, { Distribution: 'dev' }, { SourceCommit: 'c'.repeat(40) }, { Target: 'x86_64-pc-windows-msvc' }, { Version: '9.1.7' }, { WindowsMinimumBuild: 19045 }]) {
    expect(() => validateCandidate({ ...record(), ...change }, bytes, options)).toThrow();
  }
  expect(() => validateCandidate(record(), Buffer.from('changed bytes!'), options)).toThrow();
  const pin = record(); pin.FfmpegEmbeddedPin.SHA256 = 'd'.repeat(64);
  expect(() => validateCandidate(pin, bytes, options)).toThrow();
});
test('Windows manifest merge preserves macOS and refuses stale or foreign artifact links', () => {
  const entry = name => ({ signature: 'test signature', url: `https://github.com/VanaLabs/tetro/releases/download/v9.1.8/${name}` });
  const base = { version, platforms: { 'darwin-aarch64': entry('Tetro.app.tar.gz') } };
  const args = { version, notes: 'Bug fixes.', publishedAt: '2026-10-14T00:00:00Z', platforms: { 'windows-x86_64': entry('Tetro_x64-setup.exe'), 'windows-aarch64': entry('Tetro_arm64-setup.exe') } };
  const merged = mergeWindowsManifest(base, args);
  expect(merged.platforms['darwin-aarch64']).toEqual(base.platforms['darwin-aarch64']);
  expect(Object.keys(base.platforms)).toEqual(['darwin-aarch64']);
  expect(() => mergeWindowsManifest({ ...base, version: '9.1.7' }, args)).toThrow();
  expect(() => mergeWindowsManifest(base, { ...args, platforms: {} })).toThrow();
  expect(() => mergeWindowsManifest(base, { ...args, platforms: { ...args.platforms, 'windows-aarch64': { signature: 'test', url: 'https://example.com/installer.exe' } } })).toThrow();
});
