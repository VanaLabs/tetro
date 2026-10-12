import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { basename } from 'node:path';
import { peMachine, windowsTargets } from './pe.mjs';

const originalMarker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
const nsisMarker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function nsisMainRecord(bytes, target) {
  if (!windowsTargets[target] || peMachine(bytes) !== windowsTargets[target]) throw new Error('Wrong Windows executable architecture');
  // Tauri patches the first marker before packing, then restores the compiler
  // output. Record the packed bytes without changing that compiler output.
  const offset = bytes.indexOf(originalMarker);
  if (offset < 0) throw new Error('Tauri bundle-type marker is missing');
  const packed = Buffer.from(bytes);
  nsisMarker.copy(packed, offset);
  return { Size: bytes.length, SHA256: hash(packed), CompilerSHA256: hash(bytes), BundleType: 'nsis', PatchOffset: offset };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, target, output] = process.argv.slice(2);
  const record = { Name: basename(path), ...nsisMainRecord(readFileSync(path), target) };
  writeFileSync(output, JSON.stringify(record, null, 2) + '\n');
}
