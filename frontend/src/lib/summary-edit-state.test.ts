import { describe, expect, test } from 'bun:test';
import type { Block } from '@blocknote/core';
import { contentSignature } from './summary-edit-state';
const p = (text: string, id = 'one', styles = {}) => ({ id, type: 'paragraph', props: {}, content: text ? [{ type: 'text', text, styles }] : [], children: [] });
const signature = (blocks: unknown[]) => contentSignature(blocks as Block[]);
describe('summary edit state', () => {
  test('editor-generated IDs and its trailing empty paragraph do not create a draft', () => {
    expect(signature([p('Arrival: 9 AM', 'new-id'), p('', 'trailing')])).toBe(signature([p('Arrival: 9 AM')]));
  });
  test('real wording and formatting changes remain edits', () => {
    expect(signature([p('Arrival: 10 AM')])).not.toBe(signature([p('Arrival: 9 AM')]));
    expect(signature([p('Arrival: 9 AM', 'one', { bold: true })])).not.toBe(signature([p('Arrival: 9 AM')]));
  });
  test('a nested human note cannot be mistaken for an empty trailing block', () => {
    expect(signature([{ ...p(''), children: [p('Bring seeds')] }])).not.toBe(signature([]));
  });
});
