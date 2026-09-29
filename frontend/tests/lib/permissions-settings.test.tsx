import React from 'react';
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const originalWindow = globalThis.window;
const calls: { command: string; args: any }[] = [];
const listeners = new Map<string, () => void>();
let denyKeys = false;
let savedKeyCount = 1;
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string, args: any) => {
  calls.push({ command, args });
  if (command === 'get_app_permissions') return { platform: 'macos', microphone: 'denied', notifications: 'not_requested' };
  if (command === 'get_recording_state') return { is_active: false };
  if (command === 'check_saved_key_access') { if (denyKeys) throw new Error('Keychain access denied. Retry.'); return savedKeyCount; }
  if (command === 'test_system_audio_access') return 'inconclusive';
  return 'granted';
} }));
const { PermissionsSettings } = await import('../../src/components/PermissionsSettings');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const text = (view: ReactTestRenderer) => JSON.stringify(view.toJSON());
const button = (view: ReactTestRenderer, label: string) => view.root.findAllByType('button').find(b => b.children.join('') === label)!;
beforeEach(() => {
  calls.length = 0; listeners.clear(); denyKeys = false; savedKeyCount = 1;
  globalThis.window = { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name), dispatchEvent: () => true } as any;
});
afterAll(() => { globalThis.window = originalWindow; mock.restore(); });
async function mount() { let view!: ReactTestRenderer; await act(async () => { view = create(<PermissionsSettings />); await tick(); }); return view; }
test('opening the tab reads status without requesting permissions or touching Keychain', async () => {
  const view = await mount();
  expect(calls.map(c => c.command).sort()).toEqual(['get_app_permissions', 'get_recording_state']);
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
test('silent audio is inconclusive and returning from System Settings refreshes live status', async () => {
  const view = await mount();
  await act(async () => { button(view, 'Test access').props.onClick(); await tick(); });
  expect(text(view)).toContain('Couldn’t verify');
  const count = calls.length;
  await act(async () => { listeners.get('focus')!(); await tick(); });
  expect(calls.length).toBe(count + 2); expect(text(view)).not.toContain('Couldn’t verify');
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
