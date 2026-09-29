// Run the named Dev app against the live frontend. Never launch or replace Tetro.app.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = '/Applications/Tetro Dev.app';
const binary = `${bundle}/Contents/MacOS/tetro`;
if (!existsSync(binary)) throw new Error('Build and install Tetro Dev first. See your local development guide.');
const identity = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', `${bundle}/Contents/Info.plist`], {encoding:'utf8'});
if (identity.status !== 0 || identity.stdout.trim() !== 'am.vanalabs.tetro.dev') throw new Error('Refusing to launch an app with a non-Dev identity.');
if (spawnSync('/usr/bin/pgrep', ['-f', '^/Applications/Tetro Dev.app/Contents/MacOS/tetro$']).status === 0) throw new Error('Quit Tetro Dev before starting hot reload. Leave consumer Tetro alone.');
await new Promise((ok, fail) => { const socket=net.createServer(); socket.once('error',()=>fail(new Error('Port 3118 is occupied; stop the previous dev server first.'))); socket.listen(3118,()=>socket.close(ok)); });
const server=spawn('pnpm', ['exec','next','dev','--hostname','localhost','-p','3118'], {cwd:frontend,stdio:'inherit',detached:true});
let app;
let stopping=false;
const stop=()=>{ if(stopping)return; stopping=true; app?.kill('SIGTERM'); try{process.kill(-server.pid,'SIGTERM');}catch{} };
process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('exit',stop);
server.on('exit',()=>{if(!stopping){stop();process.exitCode=1;}});
let ready=false;
for(let n=0;n<90 && server.exitCode===null;n++) {
 try { const response=await fetch('http://localhost:3118', {signal:AbortSignal.timeout(1500)}); if(response.ok){ready=true;break;} } catch {}
 await new Promise(r=>setTimeout(r,500));
}
if(!ready){stop();throw new Error('Frontend dev server did not become ready.');}
app=spawn(binary,[],{env:{...process.env,TETRO_DEV_SERVER:'1'},stdio:'inherit'});
app.on('exit',()=>stop());
console.log('Tetro Dev hot reload is running. UI edits update live. Rust changes require rebuilding/reinstalling Tetro Dev.');
