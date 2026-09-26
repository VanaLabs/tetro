import React from 'react';
import { afterEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

type Registration = { resolve: (off: () => void) => void; off: ReturnType<typeof mock>; callback: (event: unknown) => void };
let registrations: Registration[] = [];
mock.module('@tauri-apps/api/event', () => ({ listen: (_: string, callback: Registration['callback']) => new Promise<() => void>(resolve => {
  let removed = false;
  registrations.push({ resolve, callback, off: mock(() => {
    // Tauri's real unlisten also throws if called twice.
    if (removed) throw new Error('listeners[eventId].handlerId');
    removed = true;
  }) });
}) }));
mock.module('@tauri-apps/api/core', () => ({ invoke: async () => null }));
mock.module('../../src/contexts/ConfigContext', () => ({ useConfig: () => ({ selectedLanguage: 'en', transcriptModelConfig: { provider: 'localWhisper', model: 'base' } }) }));
const noop = () => {};
mock.module('../../src/hooks/useTranscriptionModels', () => ({ useTranscriptionModels: () => ({ availableModels: [], selectedModelKey: '', setSelectedModelKey: noop, loadingModels: false, fetchModels: noop, resetSelection: noop }) }));
mock.module('../../src/components/ui/dialog', () => Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle'].map(key => [key, () => null])));
mock.module('sonner', () => ({ toast: { warning: noop, success: noop, error: noop } }));
const { RetranscribeDialog } = await import('../../src/components/MeetingDetails/RetranscribeDialog');
const { useImportAudio } = await import('../../src/hooks/useImportAudio');
function Import() { useImportAudio({}); return null; }
let view: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; registrations = []; });

for (const mode of ['retranscription', 'import'] as const) {
  for (const resolvedCount of [0, 1, 2, 3]) {
    test(`${mode}: closing after ${resolvedCount} registrations cleans each listener once`, async () => {
      await act(async () => { view = create(mode === 'import' ? <Import /> : <RetranscribeDialog open onOpenChange={noop} meetingId="qa" meetingFolderPath="/qa" />); });
      for (let i = 0; i < resolvedCount; i++) await act(async () => registrations[i].resolve(registrations[i].off));
      await act(async () => view!.unmount());
      view = undefined;
      // Finish registration after the dialog is already gone.
      for (const registration of registrations) await act(async () => registration.resolve(registration.off));
      for (const registration of registrations) expect(registration.off).toHaveBeenCalledTimes(1);
    });
  }
}
