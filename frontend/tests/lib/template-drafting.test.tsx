import React from 'react';
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const storage = new Map<string, string>();
const originalStorage = globalThis.localStorage;
let failure = false;
mock.module('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
mock.module('@/components/ui/dialog', () => ({ Dialog: () => null, DialogContent: () => null, DialogTitle: () => null, DialogDescription: () => null }));
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string) => {
  if (command === 'api_get_model_config') return { provider: 'builtin-ai', model: 'qwen3.5:2b' };
  if (command === 'api_draft_template') {
    if (failure) throw 'Tetro couldn’t reach your summary model. Try again, check Settings → Models, or start from scratch. Your description is still here.';
    return { template: { name: 'Catch up with friends', description: 'Catch-up notes', sections: [{ title: 'Updates', instruction: 'Extract recorded updates', format: 'list' }] }, model_label: '', notice: 'Your model couldn’t finish a usable draft, so Tetro prepared a simple starting layout. Review the sections and change anything you like.' };
  }
} }));
const { TemplateEditor } = await import('../../src/components/tetro/TemplateEditor');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const text = (view: ReactTestRenderer) => JSON.stringify(view.toJSON());
const button = (view: ReactTestRenderer, label: string) => view.root.findAllByType('button').find(b => b.children.some(c => c === label))!;
beforeEach(() => {
  storage.clear(); failure = false;
  globalThis.localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } as any;
});
afterAll(() => { globalThis.localStorage = originalStorage; mock.restore(); });
async function mount() { let view!: ReactTestRenderer; await act(async () => { view = create(<TemplateEditor onSaved={() => {}} onClose={() => {}} />); await tick(); }); return view; }
test('short descriptions draft and explain a fallback without JSON errors', async () => {
  const view = await mount();
  act(() => view.root.findByProps({ id: 'tetro-brief' }).props.onChange({ target: { value: 'Friends' } }));
  expect(button(view, 'Draft template').props.disabled).toBe(false);
  await act(async () => { button(view, 'Draft template').props.onClick(); await tick(); });
  expect(text(view)).toContain('starting layout'); expect(text(view)).not.toContain('Drafted by');
  expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  expect(view.root.findAllByType('input')[0].props.value).toBe('Catch up with friends');
  expect(JSON.parse(storage.get('tetro.templateDraft.new')!).draftNotice).toContain('starting layout');
  act(() => view.unmount());
});
test('connection failure keeps the description and offers retry or manual editing', async () => {
  const view = await mount(); failure = true;
  act(() => view.root.findByProps({ id: 'tetro-brief' }).props.onChange({ target: { value: 'Catch up with friends' } }));
  await act(async () => { button(view, 'Draft template').props.onClick(); await tick(); });
  expect(view.root.findByProps({ id: 'tetro-brief' }).props.value).toBe('Catch up with friends');
  expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  expect(button(view, 'Draft template').props.disabled).toBe(false);
  expect(button(view, 'Start from scratch').props.disabled).toBe(false);
  act(() => view.unmount());
});
