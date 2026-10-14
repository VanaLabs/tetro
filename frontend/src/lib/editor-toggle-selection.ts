type EditorBlock = { id: string; children: readonly EditorBlock[] };
type ToggleEditor = {
  getBlock(id: string): EditorBlock | undefined;
  getSelection(): { blocks: readonly EditorBlock[] } | undefined;
  getTextCursorPosition(): { block: EditorBlock };
  setTextCursorPosition(id: string, placement: 'end'): void;
};

// BlockNote's toolbar retries zero-size selection rectangles. Collapsing a
// selected child makes its rectangle stay zero, starving the WebView event loop.
// Run in click capture, before the toggle button hides the selected DOM.
export function prepareToggleCollapse(target: EventTarget | null, editor: ToggleEditor): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const button = (target as Element).closest('.bn-toggle-button');
  if (!button || button.closest('.bn-toggle-wrapper')?.getAttribute('data-show-children') !== 'true') return false;
  const id = button.closest<HTMLElement>('.bn-block-outer[data-id]')?.dataset.id;
  const parent = id ? editor.getBlock(id) : undefined;
  if (!parent || !parent.children.length) return false;

  const descendants = new Set<string>();
  const visit = (blocks: readonly EditorBlock[]) => {
    for (const block of blocks) { descendants.add(block.id); visit(block.children); }
  };
  visit(parent.children);
  const selection = editor.getSelection();
  const selected = selection?.blocks ?? [editor.getTextCursorPosition().block];
  if (!selected.some(block => descendants.has(block.id))) return false;
  editor.setTextCursorPosition(parent.id, 'end');
  return true;
}
