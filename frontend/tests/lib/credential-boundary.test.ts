import { afterAll, expect, mock, test } from 'bun:test';
const writes: unknown[] = [];
const events: unknown[] = [];
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string, args: unknown) => {
  if (command === 'api_get_model_config') return { provider: 'openai', model: 'old', whisperModel: 'tiny', apiKey: 'dummy-legacy-secret' };
  writes.push(args);
} }));
mock.module('@tauri-apps/api/event', () => ({ emit: async (_event: string, value: unknown) => { events.push(value); } }));
const { saveSummaryModel } = await import('../../src/lib/summaryModel');
afterAll(() => mock.restore());
test('a newly entered key is sent only to the save command, never to events or returned config', async () => {
  const result = await saveSummaryModel({ provider: 'openai', model: 'new', customOpenAIApiKey: 'dummy-custom' }, 'dummy-new-key');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ apiKey: 'dummy-new-key' });
  expect(result.apiKey).toBeNull(); expect(result.customOpenAIApiKey).toBeNull();
  expect(JSON.stringify(events)).not.toContain('dummy-');
});
