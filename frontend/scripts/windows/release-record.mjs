import { createHash } from 'node:crypto';

const targets = ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function newerVersion(version, latest) {
  const parse = value => {
    const match = /^v?(9)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    if (!match) throw new Error('Expected a three-part Tetro version in series 9');
    return match.slice(1).map(Number);
  };
  const a = parse(version), b = parse(latest);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Refuse Dev, mixed-source, stale, tampered, or incomplete consumer packages. */
export function validateCandidate(record, bytes, { source, target, version }) {
  if (!targets.includes(target) || !/^[0-9a-f]{40}$/.test(source)) throw new Error('Invalid release source or target');
  if (record.SourceCommit !== source || record.Target !== target || record.Version !== version) throw new Error('Candidate source, architecture, or version differs');
  if (record.Product !== 'Tetro' || record.Identity !== 'am.vanalabs.tetro' || record.Distribution !== 'candidate') throw new Error('A consumer release requires the consumer identity');
  if (record.WindowsMinimumBuild < 22000 || record.Publication !== 'not published') throw new Error('Candidate Windows policy differs');
  const name = record.Installer?.Name;
  const arch = target.startsWith('x86_64') ? 'x64' : 'arm64';
  if (name !== `Tetro_${version}_${arch}-setup.exe`) throw new Error('Unexpected consumer installer filename');
  if (bytes.length !== record.Installer.Size || sha256(bytes) !== record.Installer.SHA256) throw new Error('Candidate installer fingerprint differs');
  if (!record.Payloads?.some(p => p.Name === 'tetro.exe') || record.Payloads.some(p => p.Name === 'tetro-dev.exe')) throw new Error('Wrong main executable in candidate');
  const pin = record.FfmpegEmbeddedPin;
  const ffmpeg = record.Payloads.find(p => p.Name === `ffmpeg-${target}.exe`);
  if (!ffmpeg || pin?.Target !== target || pin.SHA256 !== ffmpeg.SHA256 || Number(pin.Size) !== ffmpeg.Size) throw new Error('Embedded FFmpeg pin differs from the native payload');
  return `windows-${arch === 'x64' ? 'x86_64' : 'aarch64'}`;
}

/** Merge Windows into the new release's manifest without dropping macOS. */
export function mergeWindowsManifest(base, { version, notes, platforms, publishedAt }) {
  if (base.version !== version || !base.platforms || !base.platforms['darwin-aarch64']) throw new Error('Supply the macOS manifest for this same new release');
  const merged = { ...base.platforms, ...platforms };
  for (const required of ['windows-x86_64', 'windows-aarch64']) {
    if (!merged[required]) throw new Error(`Missing ${required} release artifact`);
  }
  const prefix = `https://github.com/VanaLabs/tetro/releases/download/v${version}/`;
  for (const item of Object.values(merged)) {
    if (!item?.signature?.trim() || !item.url?.startsWith(prefix)) throw new Error('Every artifact needs a signature and this exact release URL');
    const filename = item.url.slice(prefix.length);
    if (!filename || /[/\\?#]/.test(filename) || filename === '.' || filename === '..') throw new Error('Invalid release artifact URL');
  }
  return { ...base, version, notes, pub_date: publishedAt, platforms: merged };
}
