import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { nsisMainRecord } from '../../scripts/windows/nsis-main-record.mjs';

const target = 'x86_64-pc-windows-msvc';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const bytes = Buffer.alloc(256); bytes.write('MZ'); bytes.writeUInt32LE(64, 60);
  bytes.set([80, 69, 0, 0], 64); bytes.writeUInt16LE(0x8664, 68);
  bytes.write('__TAURI_BUNDLE_TYPE_VAR_UNK', 100);
  bytes.write('__TAURI_BUNDLE_TYPE_VAR_UNK', 160);
  return bytes;
}
test('records the NSIS payload hash while preserving the compiler executable', () => {
  const original = fixture(); const snapshot = Buffer.from(original);
  const packed = Buffer.from(original); packed.write('__TAURI_BUNDLE_TYPE_VAR_NSS', 100);
  const record = nsisMainRecord(original, target);
  expect(record.SHA256).toBe(hash(packed));
  expect(record.CompilerSHA256).toBe(hash(snapshot));
  expect(record.PatchOffset).toBe(100);
  expect(original.equals(snapshot)).toBe(true);
  const otherChange = Buffer.from(packed); otherChange[80] ^= 1;
  expect(record.SHA256).not.toBe(hash(otherChange));
});
test('rejects missing metadata and mismatched or malformed native executables', () => {
  const missing = fixture(); missing.fill(0, 100);
  expect(() => nsisMainRecord(missing, target)).toThrow();
  expect(() => nsisMainRecord(fixture(), 'aarch64-pc-windows-msvc')).toThrow();
  expect(() => nsisMainRecord(Buffer.alloc(10), target)).toThrow();
});
