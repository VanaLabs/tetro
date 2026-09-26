import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
const oldWindow = globalThis.window;
const events: unknown[] = [];
const writes: string[] = [];
let fail = false;
mock.module('@tauri-apps/api/core', () => ({ invoke: async (_command: string, args: { model: string }) => { if (fail) throw new Error('Disk unavailable'); writes.push(args.model); } }));
mock.module('../../src/lib/summaryModel', () => ({ saveSummaryModel: async (args: { model: string }) => { if (fail) throw new Error('Disk unavailable'); writes.push(args.model); } }));
const activation = await import('../../src/lib/model-activation');
beforeEach(() => { events.length = 0; writes.length = 0; fail = false; globalThis.window = { dispatchEvent: (e: unknown) => { events.push(e); return true; } } as unknown as Window & typeof globalThis; });
afterAll(() => { globalThis.window = oldWindow; mock.restore(); });
test('a failed save never announces a model as active', async () => {
  fail = true;
  await expect(activation.activateModel('localWhisper', 'tiny')).rejects.toThrow('Disk unavailable');
  expect(writes).toEqual([]); expect(events).toEqual([]);
});
test('changing your choice prevents a late download from overriding it', async () => {
  activation.requestModelActivation('localWhisper', 'large');
  await activation.activateModel('parakeet', 'fast');
  expect(await activation.activateDownloadedModel('localWhisper', 'large')).toBe(false);
  expect(writes).toEqual(['fast']);
});
test('download and use applies only the last requested model for that purpose', async () => {
  activation.requestModelActivation('builtin-ai', 'big'); activation.requestModelActivation('builtin-ai', 'small');
  expect(await activation.activateDownloadedModel('builtin-ai', 'big')).toBe(false);
  expect(await activation.activateDownloadedModel('builtin-ai', 'small')).toBe(true);
  expect(await activation.activateDownloadedModel('builtin-ai', 'small')).toBe(false);
  expect(writes).toEqual(['small']);
});
test('cancelled download never switches the active model', async () => {
  activation.requestModelActivation('localWhisper', 'base'); activation.cancelModelActivation('localWhisper', 'base');
  expect(await activation.activateDownloadedModel('localWhisper', 'base')).toBe(false); expect(writes).toEqual([]);
});
test('choosing a connected service supersedes a pending built-in download', async () => {
  activation.requestModelActivation('builtin-ai', 'large');
  await activation.activateNotesModel({ provider: 'openai', model: 'connected-model' }, 'test-only');
  expect(await activation.activateDownloadedModel('builtin-ai', 'large')).toBe(false);
  expect(writes).toEqual(['connected-model']);
});
test('an Ollama download cannot overwrite a more recent notes choice', async () => {
  activation.requestModelActivation('ollama', 'large');
  await activation.activateNotesModel({ provider: 'builtin-ai', model: 'small' });
  expect(await activation.activateDownloadedModel('ollama', 'large')).toBe(false);
  expect(writes).toEqual(['small']);
});
