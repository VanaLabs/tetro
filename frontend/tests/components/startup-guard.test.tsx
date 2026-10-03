import React from 'react';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

let resolveStartup: (issue: string | null) => void;
let rejectStartup: (error: Error) => void;
let resolveRetry: () => void;
let rejectRetry: (error: Error) => void;
const commands: string[] = [];
mock.module('@tauri-apps/api/core', () => ({
  invoke: (command: string) => {
    commands.push(command);
    if (command === 'api_startup_issue') return new Promise<string | null>((resolve, reject) => {
      resolveStartup = resolve;
      rejectStartup = reject;
    });
    if (command === 'api_retry_startup') return new Promise<void>((resolve, reject) => {
      resolveRetry = resolve;
      rejectRetry = reject;
    });
    throw new Error(`Unexpected command: ${command}`);
  },
}));
mock.module('../../src/components/tetro/TetroStartupScreen', () => ({
  TetroStartupScreen: () => <main role="status">Opening Tetro…</main>,
}));
const { StartupGuard } = await import('../../src/components/tetro/StartupGuard');
let view: ReactTestRenderer;
let appMounts = 0;
function App() { appMounts++; return <div data-app>Workspace</div>; }
const retryButton = () => view.root.findAllByType('button')[0];

beforeEach(() => { commands.length = 0; appMounts = 0; });
afterEach(async () => { await act(async () => view?.unmount()); });

test('startup splash holds the workspace until the library is ready', async () => {
  await act(async () => { view = create(<StartupGuard><App /></StartupGuard>); });
  expect(view.root.findByProps({ role: 'status' }).children).toEqual(['Opening Tetro…']);
  expect(appMounts).toBe(0);
  expect(commands).toEqual(['api_startup_issue']);
  await act(async () => resolveStartup(null));
  expect(appMounts).toBe(1);
  expect(view.root.findAllByProps({ role: 'status' })).toHaveLength(0);
});

test('library errors remain actionable and retry cannot reveal the app before success', async () => {
  await act(async () => { view = create(<StartupGuard><App /></StartupGuard>); });
  await act(async () => resolveStartup('Library could not open'));
  expect(view.root.findByProps({ role: 'alert' })).toBeDefined();
  expect(appMounts).toBe(0);
  await act(async () => { retryButton().props.onClick(); });
  expect(retryButton().props.disabled).toBe(true);
  await act(async () => rejectRetry(new Error('Still unavailable')));
  expect(view.root.findByType('pre').children).toEqual(['Error: Still unavailable']);
  expect(retryButton().props.disabled).toBe(false);
  expect(appMounts).toBe(0);
  await act(async () => { retryButton().props.onClick(); });
  await act(async () => resolveRetry());
  expect(appMounts).toBe(1);
  expect(commands).toEqual(['api_startup_issue', 'api_retry_startup', 'api_retry_startup']);
});

test('a failed startup check shows the error instead of leaving the splash indefinitely', async () => {
  await act(async () => { view = create(<StartupGuard><App /></StartupGuard>); });
  await act(async () => rejectStartup(new Error('IPC unavailable')));
  expect(view.root.findByProps({ role: 'alert' })).toBeDefined();
  expect(view.root.findByType('pre').children).toEqual(['Error: IPC unavailable']);
  expect(appMounts).toBe(0);
});
