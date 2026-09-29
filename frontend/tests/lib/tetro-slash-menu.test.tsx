import { expect, test } from 'bun:test';
import { act, create } from 'react-test-renderer';
import type { DefaultReactSuggestionItem } from '@blocknote/react';
import { TetroSlashMenu } from '../../src/components/AISummary/TetroSlashMenu';

test('keyboard selection scrolls the command list without scrolling the summary pane', () => {
  const selected = {
    getBoundingClientRect: () => ({ top: 125, bottom: 145 }),
    scrollIntoView: () => { throw new Error('Would scroll the summary pane'); },
  };
  const menu = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 80 }),
    querySelector: () => selected,
  };
  const items = [
    { title: 'Paragraph', onItemClick: () => {} },
    { title: 'Heading 1', onItemClick: () => {} },
  ] as DefaultReactSuggestionItem[];
  let clicked = '';
  let view: ReturnType<typeof create>;

  act(() => {
    view = create(
      <TetroSlashMenu items={items} loadingState="loaded" selectedIndex={1} onItemClick={item => { clicked = item.title; }} />,
      { createNodeMock: element => element.props.id === 'bn-suggestion-menu' ? menu : null },
    );
  });

  expect(menu.scrollTop).toBe(65);
  act(() => view!.root.findAllByProps({ role: 'option' })[1].props.onClick());
  expect(clicked).toBe('Heading 1');
  act(() => view!.unmount());
});
