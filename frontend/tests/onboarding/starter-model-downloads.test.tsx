import React from 'react';
import { afterEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const downloads: Array<{ command: string; modelName: string; selectWhenReady?: boolean }> = [];
mock.module('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args?: { modelName?: string; selectWhenReady?: boolean }) => {
    if (command.endsWith('_download_model')) downloads.push({ command, modelName: args?.modelName || '', selectWhenReady: args?.selectWhenReady });
    if (command === 'builtin_ai_is_model_ready') return true;
    return undefined;
  },
}));
mock.module('@tauri-apps/api/event', () => ({ listen: async () => () => {}, emit: async () => {} }));
mock.module('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }));
mock.module('../../src/components/onboarding/OnboardingContainer', () => ({
  OnboardingContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
mock.module('../../src/contexts/OnboardingContext', () => ({
  STARTER_TRANSCRIPTION_MODEL: 'tiny',
  isStarterTranscriptionReady: async () => true,
  useOnboarding: () => ({
    goNext: () => {},
    whisperReady: false,
    setWhisperReady: () => {},
    summaryModelDownloaded: false,
    setSummaryModelDownloaded: () => {},
    selectedSummaryModel: 'qwen3.5:2b',
    completeOnboarding: async () => {},
  }),
}));

const { DownloadProgressStep } = await import('../../src/components/onboarding/steps/DownloadProgressStep');
let view: ReactTestRenderer;
const button = (label: string) => view.root.findAllByType('button').find((item) =>
  item.props['aria-label'] === label || item.children.some((child) => child === label)
)!;

afterEach(async () => {
  await act(async () => view?.unmount());
  downloads.length = 0;
});

test('opening setup never downloads models; each explicit button chooses only the smallest model', async () => {
  await act(async () => { view = create(<DownloadProgressStep isMac />); });
  expect(downloads).toEqual([]);

  await act(async () => button('Download for summaries').props.onClick());
  expect(downloads).toEqual([{ command: 'builtin_ai_download_model', modelName: 'qwen3.5:2b', selectWhenReady: true }]);

  await act(async () => button('Download Whisper Tiny').props.onClick());
  expect(downloads).toEqual([
    { command: 'builtin_ai_download_model', modelName: 'qwen3.5:2b', selectWhenReady: true },
    { command: 'whisper_download_model', modelName: 'tiny', selectWhenReady: undefined },
  ]);

  await act(async () => button('Download Parakeet').props.onClick());
  expect(downloads.at(-1)).toEqual({ command: 'parakeet_download_model', modelName: 'stt-parakeet-multilingual', selectWhenReady: undefined });
});
