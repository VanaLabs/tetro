import { test, expect } from 'bun:test';
import { allTranscriptLines } from '../../src/lib/all-transcript-lines';

test('search includes matches after the first displayed page', async () => {
  const pages = [[{ text: 'opening' }], [{ text: 'last-page match' }]];
  const result = await allTranscriptLines(async offset => ({ transcripts: pages[offset], total_count: 2 }));
  expect(result.map(r => r.text)).toEqual(['opening', 'last-page match']);
});
test('an incomplete page is an error, not an empty search result', async () => {
  await expect(allTranscriptLines(async () => ({ transcripts: [], total_count: 5 }))).rejects.toThrow('could not be loaded');
});
test('navigation stops requesting more pages', async () => {
  let calls = 0;
  await expect(allTranscriptLines(async () => { calls++; return { transcripts: ['one'], total_count: 1000 }; }, () => calls > 0)).rejects.toThrow('cancelled');
  expect(calls).toBe(1);
});
