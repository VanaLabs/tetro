import React from 'react';
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { feedbackUrl } from '../../src/lib/feedback';

const originalFetch = globalThis.fetch;
const calls: { command: string; args: unknown }[] = [];
const errors: string[] = [];
const views: ReactTestRenderer[] = [];
let versionResult: string | Error | Promise<string> = '9.1.11';
let openResult: Promise<void> | Error | undefined;
let checks = 0;
let updateDialogs = 0;
const updates = {
  isChecking: false,
  updateInfo: null as null | { available: boolean },
  checkForUpdates: async () => { checks++; },
  showUpdateDialog: () => { updateDialogs++; },
};
mock.module('@tauri-apps/api/app', () => ({ getVersion: async () => {
  if (versionResult instanceof Error) throw versionResult;
  return versionResult;
} }));
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string, args: unknown) => {
  calls.push({ command, args });
  if (openResult instanceof Error) throw openResult;
  return openResult;
} }));
mock.module('../../src/components/tetro/TetroBrand', () => ({ TetroLiveBrand: () => <span>Tetro</span> }));
mock.module('../../src/components/UpdateCheckProvider', () => ({ useUpdateCheckContext: () => updates }));
mock.module('sonner', () => ({ toast: { error: (message: string) => errors.push(message) } }));
const { About } = await import('../../src/components/About');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const button = (view: ReactTestRenderer, label: string) => view.root.findAllByType('button')
  .find(node => node.children.filter(child => typeof child === 'string').join('').trim() === label)!;
async function mount() {
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<About />); views.push(view); await tick(); });
  return view;
}
beforeEach(() => {
  calls.length = 0; errors.length = 0; versionResult = '9.1.11'; openResult = undefined;
  checks = 0; updateDialogs = 0; updates.isChecking = false; updates.updateInfo = null;
  globalThis.fetch = Object.assign(async () => new Response('Example license notices'), { preconnect: originalFetch.preconnect });
});
afterEach(() => { act(() => { for (const view of views.splice(0)) view.unmount(); }); });
afterAll(() => { globalThis.fetch = originalFetch; mock.restore(); });

test('feedback always opens the fixed GitHub chooser and sends only a valid public version', () => {
  for (const version of ['9.1.11', '9.2.0-beta.1+dev']) {
    const url = new URL(feedbackUrl(version));
    expect(url.origin + url.pathname).toBe('https://github.com/VanaLabs/tetro/issues/new/choose');
    expect([...url.searchParams]).toEqual([['app-version', version]]);
    expect(url.hash).toBe('');
  }
  for (const version of [undefined, null, '', 'unavailable', 'https://example.com', '9.1.11&body=private text']) {
    expect(feedbackUrl(version)).toBe('https://github.com/VanaLabs/tetro/issues/new/choose');
  }
});

test('About sends feedback through the native browser opener with a visible public-post notice', async () => {
  const view = await mount();
  const feedback = button(view, 'Send feedback');
  const notice = view.root.findByProps({ id: feedback.props['aria-describedby'] });
  expect(notice.children.join('')).toBe('Opens GitHub. Posts are public and require an account.');
  await act(async () => { feedback.props.onClick(); await tick(); });
  expect(calls).toEqual([{ command: 'open_external_url', args: {
    url: 'https://github.com/VanaLabs/tetro/issues/new/choose?app-version=9.1.11',
  } }]);
  expect(button(view, 'Send feedback').props.disabled).toBe(false);
  expect(view.root.findByProps({ role: 'tabpanel' }).props['aria-label']).toBe('About');
  expect(errors).toHaveLength(0);
});

test('a pending opener rejects duplicate clicks while other About actions remain usable', async () => {
  let finish!: () => void;
  openResult = new Promise(resolve => { finish = resolve; });
  const view = await mount();
  const click = button(view, 'Send feedback').props.onClick;
  await act(async () => { click(); click(); await tick(); });
  expect(calls).toHaveLength(1);
  expect(button(view, 'Send feedback').props.disabled).toBe(true);
  expect(button(view, 'Send feedback').props['aria-busy']).toBe(true);
  expect(button(view, 'Vana Labs').props.disabled).toBeUndefined();
  expect(button(view, 'Check for updates').props.disabled).toBe(false);
  await act(async () => { finish(); await tick(); });
  expect(button(view, 'Send feedback').props.disabled).toBe(false);
});

test('a failed browser launch shows a clear error and allows a successful retry', async () => {
  openResult = new Error('Native failure details');
  const view = await mount();
  await act(async () => { button(view, 'Send feedback').props.onClick(); await tick(); });
  expect(errors).toEqual(['Could not open GitHub. Please try again.']);
  expect(button(view, 'Send feedback').props.disabled).toBe(false);
  expect(view.root.findByProps({ role: 'tabpanel' }).props['aria-label']).toBe('About');
  openResult = undefined;
  await act(async () => { button(view, 'Send feedback').props.onClick(); await tick(); });
  expect(calls).toHaveLength(2);
  expect(errors).toHaveLength(1);
});

test('feedback is usable before version discovery finishes and uses the version once available', async () => {
  let finishVersion!: (version: string) => void;
  versionResult = new Promise(resolve => { finishVersion = resolve; });
  const view = await mount();
  await act(async () => { button(view, 'Send feedback').props.onClick(); await tick(); });
  expect(calls[0].args).toEqual({ url: 'https://github.com/VanaLabs/tetro/issues/new/choose' });
  await act(async () => { finishVersion('9.1.11'); await tick(); });
  await act(async () => { button(view, 'Send feedback').props.onClick(); await tick(); });
  expect(calls[1].args).toEqual({ url: feedbackUrl('9.1.11') });
});

test('failed version discovery does not send the unavailable label to GitHub', async () => {
  versionResult = new Error('Metadata unavailable');
  const view = await mount();
  await act(async () => { button(view, 'Send feedback').props.onClick(); await tick(); });
  expect(calls[0].args).toEqual({ url: 'https://github.com/VanaLabs/tetro/issues/new/choose' });
});

test('Licenses remains accessible and update actions keep their original routing', async () => {
  const view = await mount();
  expect(view.root.findAllByType('button').filter(node => node.children.join('') === 'Licenses')).toHaveLength(1);
  await act(async () => { button(view, 'Licenses').props.onClick(); await tick(); });
  expect(JSON.stringify(view.toJSON())).toContain('Example license notices');
  await act(async () => { button(view, 'About').props.onClick(); await tick(); });
  await act(async () => { button(view, 'Check for updates').props.onClick(); await tick(); });
  expect(checks).toBe(1); expect(updateDialogs).toBe(0);
  updates.updateInfo = { available: true };
  act(() => view.update(<About />));
  act(() => button(view, 'Update available').props.onClick());
  expect(updateDialogs).toBe(1); expect(checks).toBe(1);
  expect(calls).toHaveLength(0);
});
