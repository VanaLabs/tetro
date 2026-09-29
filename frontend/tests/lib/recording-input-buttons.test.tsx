import React from 'react';
import { afterAll, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const setInputMuted = mock(async () => {});
const state = { inputs: { microphone_muted: false, system_muted: false }, inputControlsReady: true, inputPending: { microphone: false, system: false }, setInputMuted };
mock.module('../../src/contexts/RecordingStateContext', () => ({ useRecordingState: () => state }));
mock.module('../../src/hooks/useRecordingLevels', () => ({ useRecordingLevels: () => ({ mic: 1, system: .5 }) }));
mock.module('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
const { DeckMeter } = await import('../../src/components/tetro/RecordingLevels');
afterAll(() => mock.restore());
test('inputs are buttons before, during and while paused; muted meter is empty and busy blocks changes', async () => {
  let view!: ReactTestRenderer; await act(async () => { view = create(<DeckMeter active={false} />); });
  const mic = () => view.root.findByProps({ 'aria-label': 'Microphone mute' });
  const system = () => view.root.findByProps({ 'aria-label': 'Computer audio mute' });
  expect(mic().type).toBe('button'); expect(mic().props.disabled).toBe(false);
  await act(async () => mic().props.onClick()); expect(setInputMuted).toHaveBeenLastCalledWith('microphone', true);
  state.inputs.microphone_muted = true;
  act(() => view.update(<DeckMeter active />));
  expect(mic().props['aria-pressed']).toBe(true);
  expect(view.root.findByProps({ 'aria-label': 'Microphone level' }).props['aria-valuenow']).toBe(0);
  expect(view.root.findByProps({ 'aria-label': 'Computer audio level' }).props['aria-valuenow']).toBe(50);
  await act(async () => mic().props.onClick()); expect(setInputMuted).toHaveBeenLastCalledWith('microphone', false);
  act(() => view.update(<DeckMeter active={false} />)); // paused remains mutable
  expect(system().props.disabled).toBe(false);
  await act(async () => system().props.onClick()); expect(setInputMuted).toHaveBeenLastCalledWith('system', true);
  act(() => view.update(<DeckMeter active disabled />)); expect(mic().props.disabled).toBe(true);
  act(() => view.unmount());
});
