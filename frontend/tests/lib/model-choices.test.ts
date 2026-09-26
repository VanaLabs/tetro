import { expect, test } from 'bun:test';
import { loadModelSources, type ModelSource, type SourceState } from '../../src/lib/model-choices';
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(a => { resolve = a; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const choice = { provider: 'builtin-ai' as const, model: 'small', label: 'Small', detail: 'This device' };
test('installed models become selectable while a remote service is still waiting', async () => {
  const slow = deferred<typeof choice[]>(); const updates: SourceState[] = [];
  const stop = loadModelSources([{ id: 'builtin-ai', label: 'Device', load: async () => [choice] }, { id: 'ollama', label: 'Ollama', load: () => slow.promise }], s => updates.push(s));
  await flush();
  expect(updates.find(s => s.source.id === 'builtin-ai' && s.status === 'ready')?.options).toEqual([choice]);
  expect(updates.at(-1)?.source.id).toBe('builtin-ai');
  slow.resolve([]); await flush(); expect(updates.at(-1)?.status).toBe('ready'); stop();
});
test('an unavailable provider does not erase installed choices', async () => {
  const updates: SourceState[] = [];
  const stop = loadModelSources([{ id: 'builtin-ai', label: 'Device', load: async () => [choice] }, { id: 'openai', label: 'OpenAI', load: async () => { throw new Error('offline'); } }], s => updates.push(s));
  await flush(); expect(updates.find(s => s.source.id === 'builtin-ai' && s.status === 'ready')?.options).toHaveLength(1);
  expect(updates.at(-1)?.status).toBe('error'); stop();
});
test('closing or switching the chooser ignores late results', async () => {
  const slow = deferred<typeof choice[]>(); const updates: SourceState[] = [];
  const stop = loadModelSources([{ id: 'ollama', label: 'Ollama', load: () => slow.promise }], s => updates.push(s));
  stop(); slow.resolve([choice]); await flush(); expect(updates.map(s => s.status)).toEqual(['loading']);
});
test('a stalled source times out and ignores its eventual result', async () => {
  const slow = deferred<typeof choice[]>(); const updates: SourceState[] = [];
  const source: ModelSource = { id: 'ollama', label: 'Ollama', load: () => slow.promise };
  const stop = loadModelSources([source], s => updates.push(s), 5);
  await new Promise(resolve => setTimeout(resolve, 15)); expect(updates.at(-1)?.status).toBe('error');
  slow.resolve([choice]); await flush(); expect(updates).toHaveLength(2); stop();
});
