// A local bundle gives macOS a distinct Dock icon and privacy identity.
// Tauri still owns the same process and rebuild watcher; nothing is installed.
import { mkdirSync, copyFileSync, writeFileSync, cpSync } from 'node:fs';
import path from 'node:path';
export function prepareDevelopmentBundle(frontend) {
  const contents = path.join(frontend, '..', 'target', 'tetro-dev', 'Tetro Dev.app', 'Contents');
  mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  copyFileSync(path.join(frontend, 'src-tauri/icons/tetro.icns'), path.join(contents, 'Resources', 'Tetro.icns'));
  writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Tetro Dev</string>
<key>CFBundleDisplayName</key><string>Tetro Dev</string>
<key>CFBundleIdentifier</key><string>am.vanalabs.tetro.dev</string>
<key>CFBundleExecutable</key><string>Tetro Dev</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.4.1</string>
<key>CFBundleIconFile</key><string>Tetro.icns</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Tetro records your microphone for meeting transcription.</string>
<key>NSScreenCaptureUsageDescription</key><string>Tetro captures system audio for meeting transcription.</string>
<key>NSAudioCaptureUsageDescription</key><string>Tetro captures system audio for meeting transcription.</string>
</dict></plist>`);
  cpSync(path.join(frontend, 'src-tauri/templates'), path.join(contents, 'Resources/templates'), { recursive: true });
  const triple = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  for (const name of ['llama-helper', 'ffmpeg']) copyFileSync(path.join(frontend, 'src-tauri/binaries', `${name}-${triple}`), path.join(contents, 'MacOS', name));
  return path.join(contents, 'MacOS', 'Tetro Dev');
}
