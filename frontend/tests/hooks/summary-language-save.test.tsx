import React from 'react';
import { afterEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

type Preference = { language: string | null; storage: 'metadata' };
let choose!: (code: string | null) => void;
let toolbar: any;
let empty: any;
const saves: { code: string | null; resolve: (value: Preference) => void; reject: (error: Error) => void }[] = [];
mock.module('../../src/lib/summary-language-preferences', () => ({
  readMeetingSummaryLanguage: async () => ({ language: 'hy', storage: 'metadata' }),
  saveMeetingSummaryLanguage: (_: string, code: string | null) => new Promise<Preference>((resolve, reject) => saves.push({ code, resolve, reject })),
}));
mock.module('../../src/components/LanguagePickerPopover', () => ({ LanguagePickerPopover: (props: any) => { choose = props.onChange; return null; } }));
mock.module('../../src/components/MeetingDetails/SummaryGeneratorButtonGroup', () => ({ SummaryGeneratorButtonGroup: (props: any) => { toolbar = props; return null; } }));
mock.module('../../src/components/EmptyStateSummary', () => ({ EmptyStateSummary: (props: any) => { empty = props; return null; } }));
mock.module('../../src/components/AISummary/BlockNoteSummaryView', () => ({ BlockNoteSummaryView: () => null }));
mock.module('../../src/components/ui/dialog', () => Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogTitle'].map(key => [key, ({ children }: any) => <>{children}</>])));
mock.module('../../src/hooks/useTemplateSuggestion', () => ({ useTemplateSuggestion: () => null }));
mock.module('../../src/hooks/useRecentLanguages', () => ({ useRecentLanguages: () => ({ addRecent: () => {} }) }));
mock.module('sonner', () => ({ toast: { info: () => {}, warning: () => {}, error: () => {} } }));
const { SummaryPanel } = await import('../../src/components/MeetingDetails/SummaryPanel');
let view: ReactTestRenderer;
const generate = mock(async () => {});
async function show() {
  const noop = () => {};
  await act(async () => { view = create(<SummaryPanel {...{
    meeting: { id: 'qa', title: 'QA', created_at: '' }, meetingTitle: 'QA', isSummaryDirty: false,
    summaryRef: { current: null }, isSaving: false, onSaveAll: async () => {}, onCopySummary: async () => {},
    onExportSummary: async () => {}, isExporting: false, aiSummary: null, summaryStatus: 'idle',
    transcripts: [{ id: 'line', text: 'English transcript', timestamp: '00:00' }],
    modelConfig: { provider: 'ollama', model: 'test', whisperModel: 'base' }, setModelConfig: noop,
    onSaveModelConfig: async () => {}, onGenerateSummary: generate, onStopGeneration: noop, customPrompt: '',
    onSaveSummary: async () => {}, onSummaryChange: noop, onDirtyChange: noop, summaryError: null,
    onRegenerateSummary: async () => {}, getSummaryStatusMessage: () => '', availableTemplates: [],
    selectedTemplate: '', onTemplateSelect: noop,
  }} />); });
}
afterEach(() => { act(() => view.unmount()); saves.length = 0; generate.mockClear(); });

test('writing waits for the chosen language to be saved, including the empty notes action', async () => {
  await show();
  act(() => choose('en'));
  expect(toolbar.languageSaving).toBe(true);
  expect(toolbar.languageLabel).toBe('English');
  await act(async () => { await toolbar.onGenerateSummary(''); await empty.onGenerate(); });
  expect(generate).not.toHaveBeenCalled();
  await act(async () => saves[0].resolve({ language: 'en', storage: 'metadata' }));
  expect(toolbar.languageSaving).toBe(false);
  await act(async () => toolbar.onGenerateSummary(''));
  expect(generate).toHaveBeenCalledTimes(1);
});

test('rapid choices keep writing blocked; a failed last save restores the last confirmed choice', async () => {
  await show();
  act(() => { choose('en'); choose('fr'); });
  expect(saves.map(s => s.code)).toEqual(['en']);
  await act(async () => saves[0].resolve({ language: 'en', storage: 'metadata' }));
  expect(saves.map(s => s.code)).toEqual(['en', 'fr']);
  expect(toolbar.languageSaving).toBe(true);
  await act(async () => saves[1].reject(new Error('Disk unavailable')));
  expect(toolbar.languageSaving).toBe(false);
  expect(toolbar.languageLabel).toBe('English');
});
