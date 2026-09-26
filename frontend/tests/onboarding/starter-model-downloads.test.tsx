import React from 'react';
import { afterEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const downloads: Array<{ command: string; modelName: string }> = [];
mock.module('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args?: { modelName?: string }) => {
    if (command.endsWith('_download_model')) downloads.push({ command, modelName: args?.modelName || '' });
    if (command === 'builtin_ai_is_model_ready') return true;
    return undefined;
  },
}));
mock.module('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
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
    selectedSummaryModel: 'gemma3:1b',
    completeOnboarding: async () => {},
  }),
}));

const { DownloadProgressStep } = await import('../../src/components/onboarding/steps/DownloadProgressStep');
let view: ReactTestRenderer;
const button = (label: string) => view.root.findAllByType('button').find((item) =>
  item.children.some((child) => child === label)
)!;

afterEach(async () => {
  await act(async () => view?.unmount());
  downloads.length = 0;
});

test('opening setup never downloads models; each explicit button chooses only the smallest model', async () => {
  await act(async () => { view = create(<DownloadProgressStep />); });
  expect(downloads).toEqual([]);

  await act(async () => button('Download for local notes').props.onClick());
  expect(downloads).toEqual([{ command: 'builtin_ai_download_model', modelName: 'gemma3:1b' }]);

  await act(async () => button('Download Whisper Tiny').props.onClick());
  expect(downloads).toEqual([
    { command: 'builtin_ai_download_model', modelName: 'gemma3:1b' },
    { command: 'whisper_download_model', modelName: 'tiny' },
  ]);
});
