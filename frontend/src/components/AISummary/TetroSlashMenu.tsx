"use client";

import { Fragment, useLayoutEffect, useRef } from 'react';
import type { DefaultReactSuggestionItem, SuggestionMenuProps } from '@blocknote/react';

export function TetroSlashMenu({ items, loadingState, selectedIndex, onItemClick }: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  const menu = useRef<HTMLDivElement>(null);

  // BlockNote's stock item calls scrollIntoView(), which also scrolls the
  // summary pane. Keep keyboard navigation within the command list instead.
  useLayoutEffect(() => {
    if (selectedIndex === undefined || !menu.current) return;
    const selected = menu.current.querySelector<HTMLElement>(`#bn-suggestion-menu-item-${selectedIndex}`);
    if (!selected) return;
    const bounds = menu.current.getBoundingClientRect();
    const itemBounds = selected.getBoundingClientRect();
    if (itemBounds.top < bounds.top) menu.current.scrollTop += itemBounds.top - bounds.top;
    else if (itemBounds.bottom > bounds.bottom) menu.current.scrollTop += itemBounds.bottom - bounds.bottom;
  }, [items, selectedIndex]);

  let previousGroup: string | undefined;
  return <div ref={menu} id="bn-suggestion-menu" className="tetro-slash-menu" role="listbox" aria-label="Summary commands">
    {items.map((item, index) => {
      const showGroup = item.group !== previousGroup;
      previousGroup = item.group;
      return <Fragment key={`${item.title}-${index}`}>
        {showGroup && item.group && <div className="tetro-slash-group" role="presentation">{item.group}</div>}
        <div
          id={`bn-suggestion-menu-item-${index}`}
          className="tetro-slash-item"
          role="option"
          aria-selected={selectedIndex === index}
          onMouseDown={event => event.preventDefault()}
          onClick={() => onItemClick?.(item)}
        >
          {item.icon && <span className="tetro-slash-icon">{item.icon}</span>}
          <span className="tetro-slash-copy"><span className="tetro-slash-title">{item.title}</span>{item.subtext && <span className="tetro-slash-detail">{item.subtext}</span>}</span>
          {item.badge && <span className="tetro-slash-shortcut">{item.badge}</span>}
        </div>
      </Fragment>;
    })}
    {items.length === 0 && <div className="tetro-slash-empty">{loadingState === 'loaded' ? 'No matching commands' : 'Loading commands…'}</div>}
  </div>;
}
