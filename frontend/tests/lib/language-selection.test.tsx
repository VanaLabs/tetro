import React, { useState } from 'react';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { recordingLanguageLabel } from '../../src/lib/recording-setup';

const armenianModel = 'stt-fastconformer-armenian';
let installed = false;
let initialLanguage = 'en';
let initialConfig = { provider: 'parakeet', model: 'stt-parakeet-multilingual' };
let whisperModels: { name: string; status: string }[] = [];
let current: any;
const saves: any[] = [];
const unlisten = mock(() => {});
const download = mock(async (_model: string) => { installed = true; });
const errors = mock(() => {});
let progress: ((event: any) => void) | undefined;
const listen = mock(async (name: string, callback: any) => {
  expect(name).toBe('parakeet-model-download-progress');
  progress = callback;
  return unlisten;
});

mock.module('../../src/contexts/ConfigContext', () => ({ useConfig: () => current }));
mock.module('../../src/services/configService', () => ({ configService: {
  saveTranscriptConfig: async (config: any) => { saves.push(config); },
} }));
mock.module('../../src/components/tetro/LanguageChooser', () => ({
  LanguageChooser: (props: any) => <select value={props.value} disabled={props.disabled} onChange={props.onChange} />,
}));
mock.module('@tauri-apps/api/event', () => ({ listen }));
mock.module('../../src/lib/parakeet', () => ({
  canonicalModelName: (model: string) => model,
  ParakeetAPI: {
    init: async () => {},
    getAvailableModels: async () => [{ name: armenianModel, status: installed ? 'Available' : 'Missing' }],
    downloadModel: download,
  },
}));
mock.module('../../src/lib/whisper', () => ({ WhisperAPI: { getAvailableModels: async () => whisperModels } }));
mock.module('sonner', () => ({ toast: { error: errors } }));

const { LanguageSelection } = await import('../../src/components/LanguageSelection');
let view: ReactTestRenderer;
function Harness() {
  const [config, setConfig] = useState(initialConfig);
  const [language, setLanguage] = useState(initialLanguage);
  current = {
    transcriptModelConfig: config,
    setTranscriptModelConfig: setConfig,
    setSelectedLanguage: async (code: string) => { setLanguage(code); },
  };
  return <><LanguageSelection provider={config.provider as 'parakeet' | 'localWhisper'} selectedLanguage={language} /><output>{recordingLanguageLabel(config.provider, config.model, language)}</output></>;
}
async function show() { await act(async () => { view = create(<Harness />); }); }
async function choose(code: string) { await act(async () => { await view.root.findByType('select').props.onChange(code); }); }
function button(label: string) {
  return view.root.findAllByType('button').find(node => node.children.join('') === label)!;
}
function text() { return JSON.stringify(view.toJSON()); }

beforeEach(() => {
  installed = false; initialLanguage = 'en'; saves.length = 0;
  initialConfig = { provider: 'parakeet', model: 'stt-parakeet-multilingual' }; whisperModels = [];
  download.mockReset(); download.mockImplementation(async () => { installed = true; });
  unlisten.mockClear(); listen.mockClear(); errors.mockClear(); progress = undefined;
});
afterEach(() => { act(() => view?.unmount()); });

test('absent NVIDIA model prompts for its 137 MB download; cancel preserves English and the current model', async () => {
  await show(); await choose('hy');
  expect(text()).toContain('NVIDIA FastConformer');
  expect(text()).toContain('137');
  expect(text()).not.toContain('Whisper');
  expect(text()).not.toContain('Automatic model switching');
  expect(view.root.findByType('select').props.value).toBe('en');
  expect(saves).toHaveLength(0);
  await act(async () => { button('Cancel').props.onClick(); });
  expect(text()).not.toContain('NVIDIA FastConformer');
  expect(view.root.findByType('output').children).toEqual(['English']);
  expect(download).not.toHaveBeenCalled();
});

test('download uses the NVIDIA API and progress, then selects Armenian in the picker and main-page label', async () => {
  let finish!: () => void;
  download.mockImplementation(() => new Promise<void>(resolve => { finish = () => { installed = true; resolve(); }; }));
  await show(); await choose('hy');
  let pending!: Promise<void>;
  await act(async () => { pending = button('Download').props.onClick(); });
  expect(download).toHaveBeenCalledWith(armenianModel);
  expect(view.root.findByType('select').props.disabled).toBe(true);
  act(() => { progress?.({ payload: { modelName: armenianModel, progress: 43 } }); });
  expect(text()).toContain('43');
  await act(async () => { finish(); await pending; });
  expect(saves).toEqual([{ provider: 'parakeet', model: armenianModel, apiKey: null }]);
  expect(view.root.findByType('select').props.value).toBe('hy');
  expect(view.root.findByType('output').children).toEqual(['Armenian']);
  expect(unlisten).toHaveBeenCalledTimes(1);
});

test('failed NVIDIA download preserves settings and can be retried', async () => {
  download.mockImplementationOnce(async () => { throw new Error('offline'); });
  await show(); await choose('hy');
  await act(async () => { await button('Download').props.onClick(); });
  expect(saves).toHaveLength(0);
  expect(view.root.findByType('output').children).toEqual(['English']);
  expect(text()).toContain('offline');
  expect(unlisten).toHaveBeenCalledTimes(1);
  await act(async () => { await button('Retry download').props.onClick(); });
  expect(view.root.findByType('output').children).toEqual(['Armenian']);
  expect(unlisten).toHaveBeenCalledTimes(2);
});

test('installed NVIDIA model switches directly; English and automatic detection stay distinct', async () => {
  installed = true;
  await show(); await choose('hy');
  expect(download).not.toHaveBeenCalled();
  expect(view.root.findByType('output').children).toEqual(['Armenian']);
  await choose('en');
  expect(saves.at(-1).model).toBe('stt-parakeet-multilingual');
  expect(view.root.findByType('output').children).toEqual(['English']);
  await choose('auto');
  expect(view.root.findByType('output').children).toEqual(['Detect automatically']);
});

test('installed large Whisper stays usable immediately; NVIDIA recommendation is optional and dismissible', async () => {
  initialConfig = { provider: 'localWhisper', model: 'large-v3' };
  whisperModels = [{ name: 'large-v3', status: 'Available' }];
  await show(); await choose('hy');
  expect(view.root.findByType('select').props.value).toBe('hy');
  expect(view.root.findByType('output').children).toEqual(['Armenian']);
  expect(saves).toHaveLength(0);
  expect(text()).toContain('Optional');
  expect(text()).toContain('137');
  expect(download).not.toHaveBeenCalled();
  await act(async () => { button('Keep current model').props.onClick(); });
  expect(text()).not.toContain('NVIDIA FastConformer');
  expect(view.root.findByType('output').children).toEqual(['Armenian']);
});

test('optional NVIDIA download explicitly switches away from the retained Whisper model', async () => {
  initialConfig = { provider: 'localWhisper', model: 'large-v3-turbo-hy' };
  whisperModels = [{ name: initialConfig.model, status: 'Available' }];
  await show(); await choose('hy');
  await act(async () => { await button('Download').props.onClick(); });
  expect(download).toHaveBeenCalledWith(armenianModel);
  expect(saves.at(-1).model).toBe(armenianModel);
  expect(view.root.findByType('output').children).toEqual(['Armenian']);
});

test('optional recommendation uses an installed NVIDIA model without downloading again', async () => {
  installed = true;
  initialConfig = { provider: 'localWhisper', model: 'large-v3' };
  whisperModels = [{ name: initialConfig.model, status: 'Available' }];
  await show(); await choose('hy');
  expect(saves).toHaveLength(0);
  await act(async () => { await button('Use NVIDIA model').props.onClick(); });
  expect(download).not.toHaveBeenCalled();
  expect(saves.at(-1).model).toBe(armenianModel);
});
