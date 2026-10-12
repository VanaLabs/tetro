import { readFileSync } from 'node:fs';

export const windowsTargets = Object.freeze({
  'x86_64-pc-windows-msvc': 0x8664,
  'aarch64-pc-windows-msvc': 0xaa64,
});

export function peMachine(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid DOS header');
  const offset = bytes.readUInt32LE(60);
  if (offset < 64 || offset + 6 > bytes.length || !bytes.subarray(offset, offset + 4).equals(Buffer.from([80, 69, 0, 0]))) {
    throw new Error('Invalid PE header');
  }
  return bytes.readUInt16LE(offset + 4);
}

export function assertWindowsMachine(path, target) {
  const expected = windowsTargets[target];
  if (!expected) throw new Error(`Unsupported Windows target: ${target}`);
  const machine = peMachine(readFileSync(path));
  if (machine !== expected) throw new Error(`${path}: expected ${target}, got PE machine 0x${machine.toString(16)}`);
  return machine;
}
