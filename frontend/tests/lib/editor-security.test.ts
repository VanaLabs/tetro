import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';

// Test the actual transitive editor dependency, not a copy of its implementation.
const require = createRequire(import.meta.url);
const editorRequire = createRequire(require.resolve('@blocknote/core'));
const { mergeAttributes } = editorRequire('@tiptap/core');

test('JSON attributes cannot inject an inherited event handler', () => {
  const attrs = mergeAttributes({ class: 'notes' }, JSON.parse('{"__proto__":{"src":"invalid:","onerror":"attack"}}'));
  expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
  expect(attrs.src).toBeUndefined();
  expect(attrs.onerror).toBeUndefined();
  const domKeys = [];
  for (const key in attrs) domKeys.push(key);
  expect(domKeys).not.toContain('onerror');
  expect(domKeys).not.toContain('src');
  expect(attrs.class).toBe('notes');
});
