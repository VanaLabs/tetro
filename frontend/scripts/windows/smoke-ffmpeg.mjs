import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertWindowsMachine } from './pe.mjs';

const [binary, target, output] = process.argv.slice(2);
assertWindowsMachine(binary, target);
mkdirSync(output, { recursive: true });
const samples = 44100 * 2;
const bytes = Buffer.alloc(44 + samples * 2);
bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(88200, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 44100) * 8000), 44 + i * 2);
const wav = join(output, 'known-tone.wav'); const mp4 = join(output, 'encoded.mp4'); const decoded = join(output, 'decoded.wav');
writeFileSync(wav, bytes);
function run(args) {
  const result = spawnSync(binary, ['-nostdin', '-y', ...args], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'FFmpeg failed');
  return result;
}
run(['-i', wav, '-c:a', 'aac', '-b:a', '96k', mp4]);
run(['-i', mp4, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', decoded]);
const returned = readFileSync(decoded);
if (returned.toString('ascii', 0, 4) !== 'RIFF' || returned.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Decoded output is not WAV');
let format; let data;
for (let offset = 12; offset + 8 <= returned.length;) {
  const size = returned.readUInt32LE(offset + 4); const end = offset + 8 + size;
  if (end > returned.length) throw new Error('Truncated WAV chunk');
  const name = returned.toString('ascii', offset, offset + 4);
  if (name === 'fmt ') format = returned.subarray(offset + 8, end);
  if (name === 'data') data = returned.subarray(offset + 8, end);
  offset = end + (size % 2);
}
if (!format || !data || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== 16000 || format.readUInt16LE(14) !== 16) throw new Error('Wrong decoded PCM format');
const duration = data.length / 32000;
let energy = 0;
for (let offset = 0; offset < data.length; offset += 2) energy += (data.readInt16LE(offset) / 32768) ** 2;
const rms = Math.sqrt(energy / (data.length / 2));
if (duration < 1.9 || duration > 2.2 || rms < 0.05 || rms > 0.4) throw new Error(`Incorrect decoded duration/energy: ${duration}/${rms}`);
writeFileSync(join(output, 'ffmpeg-smoke.json'), JSON.stringify({ target, result: 'passed', durationSeconds: duration, rms, checks: ['native PE machine', 'AAC/MP4 encoding', '16kHz mono PCM decoding', 'known-tone duration/energy'] }, null, 2) + '\n');
console.log(`FFmpeg ${target}: native encoding/decoding smoke passed.`);
