import React from 'react';
import { afterAll, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { RecordingInputs } from '../../src/hooks/useRecordingInputs';
let receive: (event: { payload: RecordingInputs }) => void = () => {};
const off = mock(() => {});
const errors = mock(() => {});
let getter: () => Promise<RecordingInputs> = async () => ({ microphone_muted: false, system_muted: false, revision: 0 });
let setter: (args: any) => Promise<RecordingInputs> = async () => { throw new Error('Disconnected'); };
const calls: any[] = [];
mock.module('@tauri-apps/api/event', () => ({ listen: async (_: string, callback: typeof receive) => { receive = callback; return off; } }));
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string, args: any) => {
  if (command === 'get_recording_inputs') return getter();
  calls.push(args); return setter(args);
} }));
mock.module('sonner', () => ({ toast: { error: errors } }));
const { useRecordingInputs } = await import('../../src/hooks/useRecordingInputs');
let controls: ReturnType<typeof useRecordingInputs>;
function Probe() { controls = useRecordingInputs(); return null; }
afterAll(() => mock.restore());

test('event wins over stale initial sync; page remount restores backend choices', async () => {
  let resolve!: (state: RecordingInputs) => void;
  getter = () => new Promise(ok => { resolve = ok; });
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<Probe />); });
  expect(controls.inputControlsReady).toBe(false);
  act(() => receive({ payload: { microphone_muted: true, system_muted: false, revision: 2 } }));
  await act(async () => resolve({ microphone_muted: false, system_muted: false, revision: 0 }));
  expect(controls.inputs.microphone_muted).toBe(true);
  act(() => view.unmount()); expect(off).toHaveBeenCalled();
  getter = async () => ({ microphone_muted: true, system_muted: true, revision: 3 });
  await act(async () => { view = create(<Probe />); });
  expect(controls.inputs.system_muted).toBe(true);
  act(() => view.unmount());
});

test('rapid clicks issue one command; only success changes state and failure remains unmuted', async () => {
  getter = async () => ({ microphone_muted: false, system_muted: false, revision: 4 });
  let resolve!: (state: RecordingInputs) => void;
  setter = () => new Promise(ok => { resolve = ok; }); calls.length = 0;
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<Probe />); });
  let pending!: Promise<void>;
  act(() => { pending = controls.setInputMuted('microphone', true); void controls.setInputMuted('microphone', true); });
  expect(calls).toEqual([{ input: 'microphone', muted: true }]);
  expect(controls.inputPending.microphone).toBe(true);
  expect(controls.inputs.microphone_muted).toBe(false);
  await act(async () => { resolve({ microphone_muted: true, system_muted: false, revision: 5 }); await pending; });
  expect(controls.inputs.microphone_muted).toBe(true);
  expect(controls.inputPending.microphone).toBe(false);
  setter = async () => { throw new Error('Disconnected'); };
  await act(async () => { await controls.setInputMuted('system', true); });
  expect(controls.inputs.system_muted).toBe(false); expect(errors).toHaveBeenCalled();
  act(() => view.unmount());
});
