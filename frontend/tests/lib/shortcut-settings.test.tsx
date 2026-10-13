import React from 'react';
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let platform = 'Win32';
const calls: string[] = [];
Object.defineProperty(globalThis, 'navigator', { configurable: true, get: () => ({ platform }) });
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string) => {
  calls.push(command);
  if (command === 'api_get_shortcuts') return { toggle_recording: 'Alt+Shift+Super+R', mark_moment: 'Alt+Shift+Super+M' };
  if (command === 'api_get_call_detection') return true;
  throw new Error(`Unexpected command: ${command}`);
} }));
mock.module('../../src/components/ui/switch', () => ({ Switch: (props: any) => <button {...props} /> }));
const { ShortcutSettings, prettyShortcut } = await import('../../src/components/tetro/ShortcutSettings');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { platform = 'Win32'; calls.length = 0; });
afterAll(() => { mock.restore(); if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else Reflect.deleteProperty(globalThis, 'navigator'); });
async function mount() { let view!: ReactTestRenderer; await act(async () => { view = create(<ShortcutSettings />); await tick(); }); return view; }

test('Windows displays its key names and does not offer the unsupported call detector', async () => {
  const view = await mount(); const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain('Alt+Shift+Win+R'); expect(rendered).toContain('Alt+Shift+Win+M');
  expect(rendered).not.toContain('⌘'); expect(rendered).not.toContain('Notice calls');
  expect(calls).toEqual(['api_get_shortcuts']);
  act(() => view.unmount());
});

test('Mac retains its shortcut symbols and call detection control', async () => {
  platform = 'MacIntel'; const view = await mount(); const rendered = JSON.stringify(view.toJSON());
  expect(rendered).toContain('⌥⇧⌘R'); expect(rendered).toContain('Notice calls');
  expect(calls).toContain('api_get_call_detection');
  expect(prettyShortcut('Control+Alt+KeyA')).toBe('⌃⌥A');
  act(() => view.unmount());
});
