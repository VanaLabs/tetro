import { expect, test } from 'bun:test';
import { peMachine } from '../../scripts/windows/pe.mjs';

function header(machine) {
  const bytes = Buffer.alloc(70); bytes.write('MZ'); bytes.writeUInt32LE(64, 60);
  bytes.set([80, 69, 0, 0], 64); bytes.writeUInt16LE(machine, 68); return bytes;
}
test('distinguishes native x64 and ARM64 executables', () => {
  expect(peMachine(header(0x8664))).toBe(0x8664);
  expect(peMachine(header(0xaa64))).toBe(0xaa64);
});
test('rejects malformed headers and out-of-range PE offsets', () => {
  expect(() => peMachine(Buffer.alloc(10))).toThrow();
  const bytes = header(0x8664); bytes.writeUInt32LE(0xffffffff, 60);
  expect(() => peMachine(bytes)).toThrow();
  const bad = header(0x8664); bad[64] = 0; expect(() => peMachine(bad)).toThrow();
});
