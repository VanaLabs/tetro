import React from 'react';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { OnboardingPermissions } from '../../src/types/onboarding';
let permissions: OnboardingPermissions;
let audioResult: unknown;
let microphone = 'not_requested';
let completed = 0, played = 0, paused = 0;
const sounds: Array<{ loop: boolean }> = [];
const calls: string[] = [];
const listeners = new Map<string, () => Promise<void>>();
const originalWindow = globalThis.window, originalAudio = globalThis.Audio;
let view: ReactTestRenderer;
const setPermissionStatus = (key: keyof OnboardingPermissions, value: any) => { permissions[key] = value; };
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string) => {
  calls.push(command);
  if (command === 'get_app_permissions') return { platform: 'macos', microphone };
  if (command === 'request_app_permission') return microphone;
  if (command === 'trigger_system_audio_permission_command') {
    if (audioResult instanceof Error) throw audioResult;
    return audioResult;
  }
} }));
mock.module('../../src/contexts/OnboardingContext', () => ({ useOnboarding: () => ({
  permissions, setPermissionStatus, setPermissionsSkipped: () => {}, completeOnboarding: async () => { completed++; },
}) }));
mock.module('../../src/components/onboarding/OnboardingContainer', () => ({
  OnboardingContainer: ({ children, footer }: any) => <div>{children}{footer}</div>,
}));
mock.module('sonner', () => ({ toast: { warning: () => {}, error: () => {} } }));
const { PermissionsStep } = await import('../../src/components/onboarding/steps/PermissionsStep');
const { OnboardingContainer } = await import('../../src/components/onboarding/OnboardingContainer');
const { PermissionRow } = await import('../../src/components/onboarding/shared/PermissionRow');
const row = (title: string) => view.root.findAllByType(PermissionRow).find(r => r.props.title === title)!;
const button = (label: string) => view.root.findAllByType('button').find(b => b.children.includes(label))!;
const text = () => JSON.stringify(view.toJSON());
async function mount() { await act(async () => { view = create(<PermissionsStep />); }); }
async function audioAction() { await act(async () => { await row('System Audio').props.onAction(); }); }
beforeEach(() => {
  permissions = { microphone: 'not_determined', systemAudio: 'not_determined', screenRecording: 'not_determined' };
  audioResult = 'inconclusive'; microphone = 'not_requested'; completed = 0; played = 0; paused = 0; calls.length = 0; sounds.length = 0;
  globalThis.window = { addEventListener: (n: string, fn: () => Promise<void>) => listeners.set(n, fn), removeEventListener: (n: string) => listeners.delete(n), location: { reload: () => {} } } as any;
  globalThis.Audio = class { loop = false; constructor() { sounds.push(this); } async play() { played++; } pause() { paused++; } } as any;
});
afterEach(() => {
  act(() => view?.unmount()); listeners.clear(); globalThis.window = originalWindow; globalThis.Audio = originalAudio;
});
test('opening onboarding reads status without capture or permission requests', async () => {
  await mount(); expect(calls).toEqual(['get_app_permissions']); expect(played).toBe(0); expect(button('Finish Setup').props.disabled).toBe(true);
});
test('silent or denied capture stays unverified, offers settings, and retries successfully', async () => {
  microphone = 'granted'; await mount(); await audioAction();
  expect(permissions.systemAudio).toBe('not_determined'); expect(text()).toContain('couldn’t confirm');
  expect(button('Finish Setup').props.disabled).toBe(true); expect(button('Try again')).toBeDefined();
  await act(async () => button('Open System Settings').props.onClick()); expect(calls.at(-1)).toBe('open_app_permission_settings');
  audioResult = 'verified'; await audioAction(); expect(permissions.systemAudio).toBe('authorized');
  expect(button('Finish Setup').props.disabled).toBe(false);
});
test('capture errors and unexpected results never authorize or falsely report denial', async () => {
  await mount(); audioResult = new Error('device disconnected'); await audioAction();
  expect(permissions.systemAudio).toBe('not_determined'); expect(text()).toContain('couldn’t start');
  audioResult = true; await audioAction(); expect(permissions.systemAudio).toBe('not_determined'); expect(text()).not.toContain('Access Denied');
});
test('pending capture blocks duplicates, completion and skip; successful sound finishes without repeating', async () => {
  let resolve!: (value: string) => void;
  audioResult = new Promise<string>(r => { resolve = r; }); await mount(); let request!: Promise<void>;
  await act(async () => { request = row('System Audio').props.onAction(); });
  expect(view.root.findByType(OnboardingContainer).props.navigationDisabled).toBe(true);
  expect(row('Microphone').props.isPending).toBe(false); expect(row('Microphone').props.disabled).toBe(true);
  expect(button("I'll do this later").props.disabled).toBe(true);
  await act(async () => {
    await row('System Audio').props.onAction(); await button('Finish Setup').props.onClick();
    await button("I'll do this later").props.onClick();
  });
  expect(calls.filter(c => c === 'trigger_system_audio_permission_command')).toHaveLength(1);
  expect(completed).toBe(0); expect(played).toBe(1);
  expect(text()).not.toContain('Play test sound');
  expect(sounds[0].loop).toBe(true);
  await act(async () => { resolve('verified'); await request; }); expect(paused).toBe(0); expect(sounds[0].loop).toBe(false);
});
test('microphone uses OS authorization and refreshes after returning from Settings', async () => {
  await mount(); microphone = 'denied'; await act(async () => row('Microphone').props.onAction());
  expect(calls).toContain('request_app_permission'); expect(permissions.microphone).toBe('denied'); microphone = 'granted';
  await act(async () => { await listeners.get('focus')!(); view.update(<PermissionsStep />); });
  expect(permissions.microphone).toBe('authorized');
});
test('unmount stops sound and ignores late capture result', async () => {
  let resolve!: (value: string) => void;
  audioResult = new Promise<string>(r => { resolve = r; }); await mount(); let request!: Promise<void>;
  await act(async () => { request = row('System Audio').props.onAction(); });
  expect(played).toBe(1); act(() => view.unmount());
  await act(async () => { resolve('verified'); await request; });
  expect(paused).toBe(1); expect(permissions.systemAudio).toBe('not_determined');
});

test('one Enable click automatically plays verification audio and grants access without another action', async () => {
  microphone = 'granted'; audioResult = 'verified'; await mount(); await audioAction();
  expect(played).toBe(1); expect(paused).toBe(0); expect(sounds[0].loop).toBe(false);
  expect(permissions.systemAudio).toBe('authorized');
  expect(button('Finish Setup').props.disabled).toBe(false);
  expect(text()).not.toContain('Play test sound');
  expect(text()).not.toContain('Try again');
});
