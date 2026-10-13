import React from 'react';
import { afterEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { importErrorMessage } from '../../src/lib/import-error';

const listeners = new Map<string, (event: { payload: any }) => unknown>();
let rejection: unknown;
mock.module('@tauri-apps/api/event', () => ({ listen: async (name: string, callback: (event: { payload: any }) => unknown) => {
  listeners.set(name, callback);
  return () => { listeners.delete(name); };
} }));
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string) => {
  if (command.includes('validate') || command === 'start_import_audio_command') throw rejection;
  return null;
} }));
mock.module('../../src/lib/summary-language-preferences', () => ({ applyPinnedSummaryLanguageToMeeting: async () => {} }));
const toast = Object.assign(mock(() => {}), { warning: mock(() => {}) });
mock.module('sonner', () => ({ toast }));
const { useImportAudio } = await import('../../src/hooks/useImportAudio');
let hook: ReturnType<typeof useImportAudio>;
let view: ReactTestRenderer | undefined;
const onError = mock(() => {});
function Harness() { hook = useImportAudio({ onError }); return null; }
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; listeners.clear(); onError.mockClear(); toast.mockClear(); });
async function mount() { await act(async () => { view = create(<Harness />); }); }

test('native browse and dropped-file validation show the same recoverable corrupt-file error', async () => {
  rejection = 'Failed to probe audio format: unsupported feature: core (probe): no suitable format reader found';
  await mount();
  for (const validate of [() => hook.selectFile(), () => hook.validateFile('/qa/empty.wav')]) {
    await act(async () => { expect(await validate()).toBeNull(); });
    expect(hook.status).toBe('error');
    expect(hook.error).toBe('Tetro could not read this file. It may be empty or damaged. Try another audio or video file.');
    expect(onError).toHaveBeenLastCalledWith(hook.error);
    await act(async () => hook.reset());
  }
});

test('an import event explains missing sound while Stop keeps the cancellation flow', async () => {
  await mount();
  await act(async () => { await listeners.get('import-error')!({ payload: { error: 'No audio track found in file' } }); });
  expect(hook.error).toBe('This file has no audio track. Choose an audio file or a video that includes sound.');
  onError.mockClear();
  await act(async () => hook.cancelImport());
  await act(async () => { await listeners.get('import-error')!({ payload: { error: 'Import cancelled' } }); });
  expect(hook.status).toBe('idle');
  expect(hook.error).toBeNull();
  expect(onError).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith('Import stopped. Your original audio file is unchanged.');
});

test('permission and unsupported-format errors keep their specific explanation', () => {
  expect(importErrorMessage(new Error('Failed to open audio file: Access is denied'))).toBe('Failed to open audio file: Access is denied');
  expect(importErrorMessage('Unsupported format: txt')).toBe('Unsupported format: txt');
  expect(importErrorMessage(undefined)).toBe('Could not import this file. Please try again.');
});
