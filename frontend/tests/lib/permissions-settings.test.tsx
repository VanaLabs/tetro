import React from 'react';
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const originalWindow = globalThis.window;
const originalAudio = globalThis.Audio;
const calls: { command: string; args: any }[] = [];
const events: string[] = [];
const listeners = new Map<string, () => void>();
let denyKeys = false;
let savedKeyCount = 1;
let recording = false;
let audioResult: string | Promise<string> | Error = 'inconclusive';
let playbackFails = false;
let playbackResult: Promise<void> | undefined;
class TestAudio {
  static instances: TestAudio[] = [];
  loop = false;
  paused = false;
  constructor(public src: string) { TestAudio.instances.push(this); }
  play() { events.push('play'); return playbackResult ?? (playbackFails ? Promise.reject(new Error('Playback failed')) : Promise.resolve()); }
  pause() { this.paused = true; }
}
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string, args: any) => {
  calls.push({ command, args });
  events.push(command);
  if (command === 'get_app_permissions') return { platform: 'macos', microphone: 'denied', notifications: 'not_requested' };
  if (command === 'get_recording_state') return { is_active: recording };
  if (command === 'check_saved_key_access') { if (denyKeys) throw new Error('Keychain access denied. Retry.'); return savedKeyCount; }
  if (command === 'test_system_audio_access') { if (audioResult instanceof Error) throw audioResult; return audioResult; }
  return 'granted';
} }));
const { PermissionsSettings } = await import('../../src/components/PermissionsSettings');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const text = (view: ReactTestRenderer) => JSON.stringify(view.toJSON());
const button = (view: ReactTestRenderer, label: string) => view.root.findAllByType('button').find(b => b.children.join('') === label)!;
beforeEach(() => {
  calls.length = 0; events.length = 0; listeners.clear(); denyKeys = false; savedKeyCount = 1;
  recording = false; audioResult = 'inconclusive'; playbackFails = false; playbackResult = undefined; TestAudio.instances.length = 0;
  globalThis.Audio = TestAudio as any;
  globalThis.window = { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name), dispatchEvent: () => true } as any;
});
afterAll(() => { globalThis.window = originalWindow; globalThis.Audio = originalAudio; mock.restore(); });
async function mount() { let view!: ReactTestRenderer; await act(async () => { view = create(<PermissionsSettings />); await tick(); }); return view; }
test('opening the tab reads status without requesting permissions or touching Keychain', async () => {
  const view = await mount();
  expect(calls.map(c => c.command).sort()).toEqual(['get_app_permissions', 'get_recording_state']);
  expect(TestAudio.instances).toHaveLength(0);
  expect(text(view)).toContain('Not allowed'); expect(text(view)).toContain('Not requested');
  await act(async () => { view.root.findAllByType('button').filter(b => b.children.join('') === 'System Settings')[0].props.onClick(); await tick(); });
  expect(calls.at(-1)).toEqual({ command: 'open_app_permission_settings', args: { permission: 'microphone' } });
  act(() => view.unmount());
});
test('denied Keychain access can be retried in the same app session', async () => {
  const view = await mount(); denyKeys = true;
  await act(async () => { button(view, 'Check access').props.onClick(); await tick(); });
  expect(text(view)).toContain('Access unavailable'); expect(view.root.findByProps({ role: 'alert' })).toBeDefined();
  denyKeys = false;
  await act(async () => { button(view, 'Retry access').props.onClick(); await tick(); });
  expect(text(view)).toContain('Access confirmed'); expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(calls.some(c => /restart|relaunch/.test(c.command))).toBe(false);
  act(() => view.unmount());
});
test('inconclusive audio stops playback and ordinary focus preserves the result', async () => {
  const view = await mount();
  await act(async () => { button(view, 'Test access').props.onClick(); await tick(); });
  expect(text(view)).toContain('Couldn’t verify');
  expect(TestAudio.instances[0].paused).toBe(true);
  const count = calls.length;
  await act(async () => { listeners.get('focus')!(); await tick(); });
  expect(calls.length).toBe(count + 2); expect(text(view)).toContain('Couldn’t verify');
  expect(TestAudio.instances).toHaveLength(1);
  await act(async () => { view.root.findAllByType('button').filter(b => b.children.join('') === 'System Settings')[1].props.onClick(); await tick(); });
  expect(calls.at(-1)).toEqual({ command: 'open_app_permission_settings', args: { permission: 'system_audio' } });
  expect(text(view)).not.toContain('Couldn’t verify');
  act(() => view.unmount());
});

test('click plays a looping signal before capture, rejects duplicates, and retains verified audio on focus', async () => {
  let finish!: (result: string) => void;
  audioResult = new Promise(resolve => { finish = resolve; });
  const view = await mount();
  const click = button(view, 'Test access').props.onClick;
  await act(async () => { click(); click(); await tick(); });
  expect(events.indexOf('play')).toBeLessThan(events.indexOf('test_system_audio_access'));
  expect(calls.filter(c => c.command === 'test_system_audio_access')).toHaveLength(1);
  const signal = TestAudio.instances[0];
  expect(signal.src).toBe('/tetro/audio-access-test.wav'); expect(signal.loop).toBe(true);
  expect(text(view)).toContain('Testing audio…'); expect(button(view, 'Testing…').props.disabled).toBe(true);
  await act(async () => { listeners.get('focus')!(); finish('verified'); await tick(); });
  expect(text(view)).toContain('Audio received'); expect(signal.loop).toBe(false); expect(signal.paused).toBe(false);
  await act(async () => { listeners.get('focus')!(); await tick(); });
  expect(text(view)).toContain('Audio received');
  act(() => view.unmount()); expect(signal.paused).toBe(true);
});

test('leaving the tab stops the signal while a pending native result completes', async () => {
  let finish!: (result: string) => void;
  audioResult = new Promise(resolve => { finish = resolve; });
  const view = await mount();
  await act(async () => { button(view, 'Test access').props.onClick(); await tick(); });
  const signal = TestAudio.instances[0];
  act(() => view.unmount()); expect(signal.paused).toBe(true);
  await act(async () => { finish('verified'); await tick(); });
  expect(signal.paused).toBe(true); expect(TestAudio.instances).toHaveLength(1);
});

test('capture waits for playback readiness and leaving during startup cancels the check', async () => {
  let started!: () => void;
  playbackResult = new Promise(resolve => { started = resolve; });
  const view = await mount();
  await act(async () => { button(view, 'Test access').props.onClick(); await tick(); });
  expect(calls.some(c => c.command === 'test_system_audio_access')).toBe(false);
  expect(text(view)).toContain('Testing audio…');
  await act(async () => { started(); await tick(); });
  expect(calls.filter(c => c.command === 'test_system_audio_access')).toHaveLength(1);
  let finishPlayback!: () => void;
  playbackResult = new Promise(resolve => { finishPlayback = resolve; });
  await act(async () => { button(view, 'Test access').props.onClick(); await tick(); });
  act(() => view.unmount());
  await act(async () => { finishPlayback(); await tick(); });
  expect(calls.filter(c => c.command === 'test_system_audio_access')).toHaveLength(1);
  expect(TestAudio.instances.at(-1)!.paused).toBe(true);
});

test('a stalled media startup finishes with an error instead of starting capture', async () => {
  playbackResult = new Promise(() => {});
  const view = await mount();
  await act(async () => { button(view, 'Test access').props.onClick(); await new Promise(resolve => setTimeout(resolve, 1050)); });
  expect(text(view)).toContain('The test sound couldn’t start. Try again.');
  expect(button(view, 'Test access').props.disabled).toBe(false); expect(TestAudio.instances[0].paused).toBe(true);
  expect(calls.some(c => c.command === 'test_system_audio_access')).toBe(false);
  act(() => view.unmount());
});

test('capture errors stop playback and a retry creates a fresh signal', async () => {
  const view = await mount(); audioResult = new Error('Could not start the audio test.');
  await act(async () => { button(view, 'Test access').props.onClick(); await tick(); });
  expect(text(view)).toContain('Could not start the audio test.'); expect(TestAudio.instances[0].paused).toBe(true);
  audioResult = 'verified';
  await act(async () => { button(view, 'Test access').props.onClick(); await tick(); });
  expect(TestAudio.instances).toHaveLength(2); expect(text(view)).toContain('Audio received');
  expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  act(() => view.unmount());
});

test('playback failure is explained and only captured samples verify access', async () => {
  playbackFails = true;
  const view = await mount(); audioResult = 'unknown';
  await act(async () => { button(view, 'Test access').props.onClick(); await tick(); });
  expect(text(view)).toContain('Couldn’t verify'); expect(text(view)).toContain('The test sound couldn’t play');
  expect(text(view)).not.toContain('Audio received'); expect(TestAudio.instances[0].paused).toBe(true);
  audioResult = 'verified';
  await act(async () => { button(view, 'Test access').props.onClick(); await tick(); });
  expect(text(view)).toContain('Audio received'); expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  act(() => view.unmount());
});

test('active recording disables the audio probe without starting sound', async () => {
  recording = true;
  const view = await mount();
  expect(button(view, 'Test access').props.disabled).toBe(true);
  expect(text(view)).toContain('Finish your recording'); expect(TestAudio.instances).toHaveLength(0);
  expect(calls.some(c => c.command === 'test_system_audio_access')).toBe(false);
  act(() => view.unmount());
});

test('no saved keys explains the prerequisite and opens the model connection page', async () => {
  savedKeyCount = 0;
  let openedModels = false;
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<PermissionsSettings onOpenModels={() => { openedModels = true; }} />); await tick(); });
  expect(text(view)).toContain('Save a key first');
  await act(async () => { button(view, 'Check access').props.onClick(); await tick(); });
  expect(text(view)).toContain('Nothing to check yet');
  expect(text(view)).toContain('No API keys are saved. Add a provider key in Models');
  expect(text(view)).toContain('Built-in models do not need an API key.');
  expect(text(view)).not.toContain('Access confirmed');
  act(() => button(view, 'Open models').props.onClick());
  expect(openedModels).toBe(true);
  act(() => view.unmount());
});
