import type { Block } from '@blocknote/core';

export function blockText(value: unknown): string {
  if (Array.isArray(value)) return value.map(blockText).join('');
  if (!value || typeof value !== 'object') return '';
  const v = value as Record<string, unknown>;
  return typeof v.text === 'string' ? v.text : blockText(v.content) + blockText(v.children);
}
export function contentSignature(blocks: Block[]): string {
  const copy = [...blocks];
  while (copy.length && copy[copy.length - 1].type === 'paragraph' && !blockText(copy[copy.length - 1]).trim()) copy.pop();
  return JSON.stringify(copy, (key, value) => key === 'id' ? undefined : value);
}
