import { expect, test } from 'bun:test';
import { prepareToggleCollapse } from '../../src/lib/editor-toggle-selection';

type TestBlock = { id: string; children: TestBlock[] };
const leaf = (id: string): TestBlock => ({ id, children: [] });
function fixture({ expanded = true, selected = ['child'], caret = false } = {}) {
  const child = { id: 'child', children: [leaf('grandchild')] };
  const parent = { id: 'parent', children: [child] };
  const calls: string[] = [];
  const button = { closest: (selector: string) => selector === '.bn-toggle-wrapper'
    ? { getAttribute: () => expanded ? 'true' : 'false' }
    : { dataset: { id: 'parent' } } };
  // The actual click may target the SVG inside the toggle button.
  const target = { closest: (selector: string) => selector === '.bn-toggle-button' ? button : null } as unknown as EventTarget;
  const editor = {
    getBlock: () => parent,
    getSelection: () => caret ? undefined : { blocks: selected.map(leaf) },
    getTextCursorPosition: () => ({ block: leaf(selected[0]) }),
    setTextCursorPosition: (id: string, placement: 'end') => { calls.push(`${id}:${placement}`); },
  };
  return { target, editor, calls };
}

test('collapse moves a selected child to the visible parent before it is hidden', () => {
  const f = fixture();
  expect(prepareToggleCollapse(f.target, f.editor)).toBe(true);
  expect(f.calls).toEqual(['parent:end']);
});
test('nested descendants and a range spanning siblings remain safe to collapse', () => {
  for (const selected of [['grandchild'], ['outside', 'grandchild']]) {
    const f = fixture({ selected });
    expect(prepareToggleCollapse(f.target, f.editor)).toBe(true);
    expect(f.calls).toEqual(['parent:end']);
  }
});
test('a caret in a child is moved even without a text selection', () => {
  const f = fixture({ caret: true });
  expect(prepareToggleCollapse(f.target, f.editor)).toBe(true);
  expect(f.calls).toEqual(['parent:end']);
});
test('expansion preserves the existing selection', () => {
  const f = fixture({ expanded: false });
  expect(prepareToggleCollapse(f.target, f.editor)).toBe(false);
  expect(f.calls).toEqual([]);
});
test('parent text and unrelated blocks retain their selection', () => {
  for (const selected of [['parent'], ['outside']]) {
    const f = fixture({ selected });
    expect(prepareToggleCollapse(f.target, f.editor)).toBe(false);
    expect(f.calls).toEqual([]);
  }
});
test('ordinary editor clicks do not inspect or move the cursor', () => {
  const f = fixture();
  expect(prepareToggleCollapse({ closest: () => null } as unknown as EventTarget, f.editor)).toBe(false);
  expect(prepareToggleCollapse(null, f.editor)).toBe(false);
  expect(f.calls).toEqual([]);
});
