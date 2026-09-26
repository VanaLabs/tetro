import React from 'react';
import { afterAll, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
let receive: (event: { payload: { mic: number; system: number } }) => void = () => {};
const unlisten = mock(() => {});
mock.module('@tauri-apps/api/event', () => ({ listen: async (_: string, callback: typeof receive) => { receive = callback; return unlisten; } }));
const { useRecordingLevels, meterLevel } = await import('../../src/hooks/useRecordingLevels');
let result: ReturnType<typeof useRecordingLevels>;
function Meter({ active }: { active: boolean }) { result = useRecordingLevels(active); return null; }
afterAll(() => mock.restore());
test('silent and invalid samples stay at zero; normal speech uses the shared decibel scale', () => {
  for (const value of [0, -1, NaN, Infinity]) expect(meterLevel(value)).toBe(0);
  expect(meterLevel(1)).toBe(1); expect(meterLevel(.1)).toBeGreaterThan(.6); expect(meterLevel(.001)).toBe(0);
});
test('mic and computer levels are independent, decay, and feed real wordmark history', async () => {
  let view!: ReactTestRenderer; await act(async () => { view = create(<Meter active />); });
  act(() => receive({ payload: { mic: .1, system: 0 } }));
  expect(result.mic).toBeGreaterThan(.6); expect(result.system).toBe(0); expect(result.history.at(-1)).toBe(result.mic);
  const previous = result.mic; act(() => receive({ payload: { mic: 0, system: .5 } }));
  expect(result.mic).toBeCloseTo(previous * .8); expect(result.system).toBeGreaterThan(.8); expect(result.history.at(-2)).toBe(previous);
  const stale = receive; await act(async () => { view.update(<Meter active={false} />); });
  act(() => stale({ payload: { mic: 1, system: 1 } }));
  expect(result.mic).toBe(0); expect(result.system).toBe(0); expect(result.history.every(value => value === 0)).toBe(true); expect(unlisten).toHaveBeenCalled();
  act(() => view.unmount());
});
