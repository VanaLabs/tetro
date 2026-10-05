// Regenerate checked-in Tetro identity assets: node scripts/generate-brand.cjs.
// Requires sharp (also resolves through NODE_PATH). No dependency at app build time.
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const frontend = path.resolve(__dirname, '..');
const identity = path.join(frontend, 'public/tetro/identity');
const icons = path.join(frontend, 'src-tauri/icons');
const letter = path.join(icons, 'letter');
const master = fs.readFileSync(path.join(identity, 'mark.svg'), 'utf8');
const markPath = master.match(/d="([^"]+)"/)[1];
const background = fs.readFileSync(path.join(identity, 'app-background.svg'), 'utf8');
const ivory = '#faf9f6';
const appInk = background.match(/data-mark-color="(#[0-9a-fA-F]{6})"/)?.[1] ?? ivory;
const svg = (size, contents) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${contents}</svg>\n`;
const mark = (ink, transform) => `<path fill="${ink}" fill-rule="evenodd" transform="${transform}" d="${markPath}"/>`;
// All cues occupy the mark's window; the silhouette never changes with state.
function cue(state, frame, ink, dock = false) {
  const x = dock ? 128.53125 : 18.125;
  const y = dock ? 97.1875 : 10.75;
  const unit = dock ? 4.25 : 1;
  const window = (inset, color) => `<rect x="${x + (-5.375 + inset) * unit}" y="${y + (-3.25 + inset) * unit}" width="${(10.75 - 2 * inset) * unit}" height="${(6.5 - 2 * inset) * unit}" rx="${(1 - inset) * unit}" fill="${color}"/>`;
  if (state === 'call' || state === 'recording') {
    // Static fallbacks and Reduce Motion keep the complete window bright.
    const color = state === 'recording' ? '#ff3b30' : dock ? '#34c759' : ink === '#ffffff' ? '#30d158' : '#28b14c';
    return window(.12, ivory) + window(.45, color);
  }
  if (state === 'paused') return [-1.25, 1.25].map(dx => `<rect x="${x + (dx - .5) * unit}" y="${y - 1.75 * unit}" width="${unit}" height="${3.5 * unit}" rx="${.45 * unit}" fill="${ink}"/>`).join('');
  if (state === 'working') {
    const radius = 2.05 * unit;
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="${ink}" stroke-width="${.9 * unit}" stroke-linecap="round" stroke-dasharray="${radius * Math.PI * 1.45} ${radius * Math.PI * .55}" transform="rotate(${frame * 30} ${x} ${y})"/>`;
  }
  return '';
}
function menu(state = 'idle', frame = 0, dark = false) {
  const ink = dark ? '#ffffff' : '#17191b';
  return svg(36, mark(ink, 'translate(2 2) scale(.125)') + cue(state, frame, ink));
}
function app(state = 'idle', frame = 0) {
  return background.replace('</svg>', mark(appInk, 'translate(240 240) scale(2.125)') + `<g transform="scale(4)">${cue(state, frame, appInk, true)}</g></svg>\n`);
}
async function raster(source, size) {
  return sharp(Buffer.from(source)).resize(size, size).ensureAlpha().png().toBuffer();
}
async function menuAsset(name, state, frame = 0, dark = false) {
  const png = await raster(menu(state, frame, dark), 36);
  fs.writeFileSync(path.join(letter, `${name}.png`), png);
  fs.writeFileSync(path.join(letter, `${name}.rgba`), await sharp(png).raw().toBuffer());
}
async function dockAsset(name, state, frame = 0) {
  fs.writeFileSync(path.join(letter, `dock-${name}.png`), await raster(app(state, frame), 256));
}
// ICNS and ICO contain standard PNG representations, without a platform tool dependency.
function container(type, chunks) {
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}
async function ico(source, sizes) {
  const pngs = await Promise.all(sizes.map(size => raster(source, size)));
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + sizes.length * 16;
  const entries = pngs.map((png, index) => {
    const entry = Buffer.alloc(16); entry[0] = entry[1] = sizes[index] === 256 ? 0 : sizes[index];
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(offset, 12); offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}
async function main() {
  fs.mkdirSync(letter, {recursive: true});
  const source = app();
  fs.writeFileSync(path.join(identity, 'app-icon.svg'), source);
  fs.writeFileSync(path.join(frontend, 'public/tetro/icon.svg'), master);
  fs.writeFileSync(path.join(identity, 'signal.svg'), master);
  const png = await raster(source, 1024);
  fs.writeFileSync(path.join(identity, 'app-icon.png'), png);
  fs.writeFileSync(path.join(icons, 'tetro.png'), png);
  const icns = [];
  for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) icns.push(container(type, [await raster(source, size)]));
  fs.writeFileSync(path.join(icons, 'tetro.icns'), container('icns', icns));
  fs.writeFileSync(path.join(icons, 'tetro.ico'), await ico(source, [16, 32, 48, 64, 128, 256]));
  fs.writeFileSync(path.join(frontend, 'src/app/favicon.ico'), await ico(source, [16, 32, 48]));
  for (const dark of [false, true]) {
    const suffix = dark ? '-dark' : '';
    await menuAsset(`idle${suffix}`, 'idle', 0, dark);
    await menuAsset(`idle-call${suffix}`, 'call', 0, dark);
    for (let frame = 0; frame < 8; frame++) await menuAsset(`recording-${frame}${suffix}`, 'recording', frame, dark);
  }
  await menuAsset('paused', 'paused');
  await dockAsset('idle', 'idle'); await dockAsset('call', 'call'); await dockAsset('paused', 'paused');
  for (let frame = 0; frame < 8; frame++) await dockAsset(`recording-${frame}`, 'recording', frame);
  for (let frame = 0; frame < 12; frame++) { await menuAsset(`working-${frame}`, 'working', frame); await dockAsset(`working-${frame}`, 'working', frame); }
  console.log('Generated app, frontend, favicon and menu/Dock identity assets.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
