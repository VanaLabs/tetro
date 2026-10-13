import React from 'react';
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

let stored: string[] = [];
let saveResult: (terms: string[]) => Promise<string[]>;
const saves: string[][] = [];
const errors: string[] = [];
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string, args: any) => {
  if (command === 'api_get_vocabulary') return stored;
  if (command === 'api_set_vocabulary') { saves.push(args.terms); return saveResult(args.terms); }
  throw new Error(`Unexpected command: ${command}`);
} }));
mock.module('sonner', () => ({ toast: { error: (message: string) => errors.push(message) } }));
const { VocabularyEditor } = await import('../../src/components/tetro/Vocabulary');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { stored = []; saves.length = 0; errors.length = 0; saveResult = async terms => stored = terms; });
afterAll(() => mock.restore());
async function mount() { let view!: ReactTestRenderer; await act(async () => { view = create(<VocabularyEditor />); await tick(); }); return view; }
const input = (view: ReactTestRenderer) => view.root.findByType('input');
function type(view: ReactTestRenderer, value: string) { act(() => input(view).props.onChange({ target: { value } })); }

test('a comma stays in the draft and Enter saves every term in one operation', async () => {
  const view = await mount();
  type(view, 'Alpha');
  let prevented = false;
  act(() => input(view).props.onKeyDown({ key: ',', preventDefault: () => prevented = true }));
  expect(prevented).toBe(false);
  expect(saves).toHaveLength(0); expect(input(view).props.disabled).toBe(false);
  type(view, 'Alpha, Beta, Gamma');
  await act(async () => { input(view).props.onKeyDown({ key: 'Enter', preventDefault: () => {} }); await tick(); });
  expect(saves).toEqual([['Alpha', 'Beta', 'Gamma']]);
  expect(input(view).props.value).toBe('');
  act(() => view.unmount());
});

test('a failed save keeps the complete draft available for retry', async () => {
  const view = await mount();
  saveResult = async () => { throw new Error('storage unavailable'); };
  type(view, 'Alpha, Beta');
  await act(async () => { input(view).props.onKeyDown({ key: 'Enter', preventDefault: () => {} }); await tick(); });
  expect(input(view).props.value).toBe('Alpha, Beta'); expect(input(view).props.disabled).toBe(false);
  expect(errors).toContain('Couldn’t save names & terms');
  saveResult = async terms => stored = terms;
  await act(async () => { view.root.findAllByType('button').find(button => button.children.join('') === 'Add')!.props.onClick(); await tick(); });
  expect(stored).toEqual(['Alpha', 'Beta']); expect(input(view).props.value).toBe('');
  act(() => view.unmount());
});

test('multi-term entries retain duplicate and length protections', async () => {
  stored = ['Alpha']; const view = await mount();
  type(view, `Beta, ${'x'.repeat(61)}`);
  await act(async () => { input(view).props.onKeyDown({ key: 'Enter', preventDefault: () => {} }); await tick(); });
  expect(saves).toHaveLength(0); expect(input(view).props.value).toContain('Beta');
  type(view, 'alpha, Beta, beta');
  await act(async () => { input(view).props.onKeyDown({ key: 'Enter', preventDefault: () => {} }); await tick(); });
  expect(stored).toEqual(['alpha', 'beta']);
  act(() => view.unmount());
});
