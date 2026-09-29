import React from 'react';
import { expect, test } from 'bun:test';
import { create, act } from 'react-test-renderer';
import { ModelRow, rowStateFromStatus } from '../../src/components/tetro/ModelRow';
test('retained transcription bytes expose resume and removal rather than a fresh download', () => {
  const state = rowStateFromStatus({ Paused: { downloaded_bytes: 1048576 } }, false);
  expect(state).toEqual({ kind: 'paused', downloadedMb: 1 });
  let resumed = 0, removed = 0;
  let view: ReturnType<typeof create>;
  act(() => { view = create(<ModelRow name="Test" sizeMb={10} sizeLabel="10 MB" state={state} onUse={() => {}} onDownload={() => resumed++} onDelete={() => removed++} />); });
  const buttons = view!.root.findAllByType('button');
  expect(buttons[0].props['aria-label']).toBe('Remove Test');
  expect(buttons[1].children.join('')).toBe('Resume');
  act(() => { buttons[0].props.onClick(); buttons[1].props.onClick(); });
  expect([removed, resumed]).toEqual([1, 1]);
  expect(rowStateFromStatus({ Paused: { downloaded_bytes: 1048576 } }, true)).toEqual({ kind: 'cancelling' });
  act(() => view!.unmount());
});
