import React from 'react';
import { afterAll, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const passthrough = ({ children }: any) => <div>{children}</div>;
const routes: string[] = [];
const calls: string[] = [];
let availableModels: any[] = [];
mock.module('next/navigation', () => ({ useRouter: () => ({ push: (href: string) => routes.push(href) }) }));
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string) => { calls.push(command); } }));
mock.module('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
mock.module('../../src/contexts/ConfigContext', () => ({ useConfig: () => ({ selectedLanguage: 'en', transcriptModelConfig: { provider: 'localWhisper', model: 'tiny' } }) }));
mock.module('../../src/hooks/useTranscriptionModels', () => ({ useTranscriptionModels: () => ({ availableModels, selectedModelKey: 'whisper:tiny', setSelectedModelKey: () => {}, loadingModels: false, fetchModels: () => {}, resetSelection: () => {} }) }));
mock.module('../../src/components/ui/dialog', () => Object.fromEntries(['Dialog', 'DialogContent', 'DialogTitle', 'DialogDescription', 'DialogFooter', 'DialogHeader'].map(name => [name, passthrough])));
mock.module('../../src/components/ui/select', () => Object.fromEntries(['Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue'].map(name => [name, passthrough])));
mock.module('../../src/components/tetro/LanguageChooser', () => ({ LanguageChooser: () => <div /> }));
const { RetranscribeDialog } = await import('../../src/components/MeetingDetails/RetranscribeDialog');
afterAll(() => mock.restore());

test('retranscribe offers the expanded download catalogue with or without installed models', async () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    for (const models of [[], [{ provider: 'whisper', name: 'tiny', displayName: 'Whisper Tiny', size_mb: 75 }]]) {
      availableModels = models;
      const closed: boolean[] = []; let view!: ReactTestRenderer;
      await act(async () => { view = create(<RetranscribeDialog open onOpenChange={value => closed.push(value)} meetingId="fixture" meetingFolderPath="/fixture" />); });
      act(() => view.root.findAllByType('button').find(button => button.children.includes('Download more models'))!.props.onClick());
      expect(closed).toEqual([false]);
      expect(routes.at(-1)).toBe('/settings');
      expect(values.get('tetro.modelsSection')).toBe('transcription');
      expect(values.get('tetro.browseTranscriptionModels')).toBe('1');
      expect(calls).toEqual([]);
      act(() => view.unmount());
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
