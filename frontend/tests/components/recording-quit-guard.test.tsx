import React, { createContext, useContext, useState } from 'react';
import { afterEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const statuses = {
  IDLE: 'idle', RECORDING: 'recording', STOPPING: 'stopping',
  PROCESSING_TRANSCRIPTS: 'processing', SAVING: 'saving',
  COMPLETED: 'completed', ERROR: 'error',
};
type State = { status: string; isRecording: boolean };
const context = createContext<State>({ status: 'recording', isRecording: true });
const listeners = new Map<string, (event: { payload: unknown }) => unknown>();
let commands: string[] = [];
let saved = false;
let view: ReactTestRenderer;
let setRecording: React.Dispatch<React.SetStateAction<State>>;

mock.module('../../src/contexts/RecordingStateContext', () => ({
  RecordingStatus: statuses, useRecordingState: () => useContext(context),
}));
mock.module('../../src/hooks/useRecordingStop', () => ({
  useRecordingStop: () => ({ handleRecordingStop: async () => {} }),
}));
mock.module('@tauri-apps/api/event', () => ({
  listen: async (name: string, callback: (event: { payload: unknown }) => unknown) => {
    listeners.set(name, callback);
    return () => { listeners.delete(name); };
  },
}));
mock.module('@tauri-apps/api/core', () => ({
  invoke: async (command: string) => {
    commands.push(command);
    if (command === 'api_finish_quit' && !saved) throw new Error('Your recording still needs to be saved.');
  },
}));
mock.module('sonner', () => ({ toast: { warning: () => {} } }));
mock.module('../../src/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
const { RecordingPostProcessingProvider } = await import('../../src/contexts/RecordingPostProcessingProvider');

function Harness() {
  const [state, update] = useState<State>({ status: 'recording', isRecording: true });
  setRecording = update;
  return <context.Provider value={state}><RecordingPostProcessingProvider><span>app</span></RecordingPostProcessingProvider></context.Provider>;
}
async function startQuit() {
  commands = []; saved = false;
  const options = { createNodeMock: () => null, unstable_isConcurrent: true };
  await act(async () => { view = create(<Harness />, options); });
  await act(async () => { await listeners.get('tetro-quit-requested')!({ payload: { pendingSave: true } }); });
  const stop = view.root.findAllByType('button').find(button => button.children.includes('Stop and save'))!;
  await act(async () => { await stop.props.onClick(); });
}
afterEach(async () => {
  await act(async () => { view?.unmount(); });
  listeners.clear();
});

test('quit completes after React batches the saved and idle status updates', async () => {
  await startQuit();
  await act(async () => { setRecording({ status: 'saving', isRecording: false }); });
  expect(commands).toEqual(['api_stop_for_quit']);
  saved = true;
  await act(async () => {
    setRecording({ status: 'completed', isRecording: false });
    setRecording({ status: 'idle', isRecording: false });
  });
  expect(commands).toEqual(['api_stop_for_quit', 'api_finish_quit']);
  await act(async () => { setRecording({ status: 'idle', isRecording: false }); });
  expect(commands.filter(command => command === 'api_finish_quit')).toHaveLength(1);
});

test('an idle transition cannot bypass the native unsaved-recording guard', async () => {
  await startQuit();
  await act(async () => { setRecording({ status: 'idle', isRecording: false }); });
  expect(commands).toEqual(['api_stop_for_quit', 'api_finish_quit']);
  expect(view.root.findByType('h1').children).toEqual(['Save this recording before quitting?']);
  expect(view.root.findAllByProps({ role: 'alert' })[0].children.join('')).toContain('still needs to be saved');
});

test('failed saving leaves the app open with a recoverable error', async () => {
  await startQuit();
  await act(async () => { setRecording({ status: 'error', isRecording: false }); });
  expect(commands).toEqual(['api_stop_for_quit']);
  expect(view.root.findAllByProps({ role: 'alert' })[0].children.join('')).toContain('could not be saved');
  expect(view.root.findAllByType('button').every(button => !button.props.disabled)).toBe(true);
});
