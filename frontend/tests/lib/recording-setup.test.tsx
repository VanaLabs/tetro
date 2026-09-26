import React from 'react';
import { expect, test, mock } from 'bun:test';
import { act, create } from 'react-test-renderer';
import { recordingLanguageLabel } from '../../src/lib/recording-setup';
import { RecordingReady } from '../../src/components/tetro/RecordingReady';

test('fixed-language engines show their actual language even with an old global preference', () => {
  expect(recordingLanguageLabel('parakeet', 'stt-fastconformer-armenian', 'en')).toBe('Armenian');
  expect(recordingLanguageLabel('parakeet', 'stt-parakeet-english', 'hy')).toBe('English');
  expect(recordingLanguageLabel('parakeet', 'stt-parakeet-multilingual', 'hy')).toBe('Detect automatically');
  expect(recordingLanguageLabel('localWhisper', 'base', 'en')).toBe('English');
  expect(recordingLanguageLabel('localWhisper', 'base', 'auto-translate')).toContain('write transcript in English');
});

test('setup choices open their pickers and lock while recording starts', () => {
  const language = mock(() => {}), model = mock(() => {});
  const props = { onStart: async () => {}, disabled: false, starting: false, finishing: false, language: 'Armenian', model: 'Armenian', onChooseLanguage: language, onChooseModel: model };
  let view!: ReturnType<typeof create>;
  act(() => { view = create(<RecordingReady {...props} />); });
  const buttons = view.root.findAllByType('button');
  act(() => { buttons[0].props.onClick(); buttons[1].props.onClick(); });
  expect(language).toHaveBeenCalledTimes(1); expect(model).toHaveBeenCalledTimes(1);
  expect(buttons[0].props['aria-label']).toContain('Spoken language: Armenian');
  act(() => view.update(<RecordingReady {...props} starting disabled />));
  expect(view.root.findAllByType('button').every(b => b.props.disabled)).toBe(true);
  act(() => view.update(<RecordingReady {...props} finishing />));
  expect(view.root.findAllByType('button')).toHaveLength(0);
  act(() => view.unmount());
});
