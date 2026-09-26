import React, { useState } from 'react';
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const Status = { IDLE: 'idle', STARTING: 'starting', RECORDING: 'recording', STOPPING: 'stopping', PROCESSING_TRANSCRIPTS: 'processing', SAVING: 'saving', ERROR: 'error' };
let status = 'idle'; let backendLive = false; let ready = true;
let validate: () => Promise<boolean> = async () => ready;
let capture: () => Promise<void> = async () => {};
const started = mock(async (...args: unknown[]) => capture());
const notices: string[] = []; const modal = mock(() => {}); const noop = () => {};
const devices = { micDevice: 'test mic', systemDevice: 'test system' };
const storage = new Map<string, string>(); const target = new EventTarget();
Object.assign(globalThis, { window: target, sessionStorage: { getItem: (key: string) => storage.get(key), removeItem: (key: string) => storage.delete(key) } });
mock.module('../../src/lib/meetingName', () => ({ formatMeetingName: () => 'Recording QA', loadNameFormat: async () => {} }));
mock.module('../../src/contexts/TranscriptContext', () => ({ useTranscripts: () => ({ clearTranscripts: noop, setMeetingTitle: noop }) }));
mock.module('../../src/components/Sidebar/SidebarProvider', () => ({ useSidebar: () => ({ setIsMeetingActive: noop }) }));
mock.module('../../src/contexts/ConfigContext', () => ({ useConfig: () => ({ selectedDevices: devices }) }));
mock.module('../../src/contexts/RecordingStateContext', () => ({ RecordingStatus: Status, useRecordingState: () => ({ status, isRecording: backendLive, isStartingRecording: status === 'starting', isStopping: status === 'stopping', isProcessing: status === 'processing', isSaving: status === 'saving', setStatus: (next: string) => { status = next; } }) }));
mock.module('@tauri-apps/api/core', () => ({ invoke: async (command: string) => command === 'api_get_transcript_config' ? { provider: 'parakeet' } : command.includes('has_available') ? validate() : command.includes('get_available_models') ? [] : undefined }));
mock.module('../../src/services/recordingService', () => ({ recordingService: { startRecordingWithDevices: started } }));
mock.module('sonner', () => ({ toast: { error: (text: string) => notices.push(text), info: (text: string) => notices.push(text) } }));
const { useRecordingStart } = await import('../../src/hooks/useRecordingStart');
let start!: () => Promise<void>;
function Harness() { const [recording, setRecording] = useState(false); start = useRecordingStart(recording, setRecording, modal).handleRecordingStart; return null; }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { status = 'idle'; backendLive = false; ready = true; validate = async () => ready; capture = async () => {}; started.mockClear(); modal.mockClear(); notices.length = 0; storage.clear(); });
afterAll(() => mock.restore());
test('center, deck and native start share one guard during validation', async () => {
  let release!: (value: boolean) => void; validate = () => new Promise(resolve => { release = resolve; });
  let view!: ReactTestRenderer; await act(async () => { view = create(<Harness />); }); let pending!: Promise<void>;
  await act(async () => { pending = start(); void start(); target.dispatchEvent(new Event('start-recording-from-sidebar')); await tick(); });
  expect(status).toBe('starting'); expect(started).toHaveBeenCalledTimes(0);
  await act(async () => { release(true); await pending; });
  expect(started).toHaveBeenCalledTimes(1); expect(started.mock.calls[0]).toEqual(['test mic', 'test system', 'Recording QA']);
  await act(async () => { await start(); }); expect(started).toHaveBeenCalledTimes(1); act(() => view.unmount());
});
test('missing model opens the chooser; installing then retrying works', async () => {
  ready = false; let view!: ReactTestRenderer; await act(async () => { view = create(<Harness />); });
  await act(async () => { await start(); }); expect(started).toHaveBeenCalledTimes(0); expect(modal).toHaveBeenCalledTimes(1); expect(status).toBe('idle');
  ready = true; await act(async () => { await start(); }); expect(started).toHaveBeenCalledTimes(1); act(() => view.unmount());
});
test('failed capture releases the guard and reports a retry path', async () => {
  capture = async () => { throw new Error('microphone permission unavailable'); }; let view!: ReactTestRenderer; await act(async () => { view = create(<Harness />); });
  await act(async () => { await start(); }); expect(status).toBe('error'); expect(notices).toContain('Couldn’t start recording');
  capture = async () => {}; await act(async () => { await start(); }); expect(started).toHaveBeenCalledTimes(2); act(() => view.unmount());
});
for (const busy of ['stopping', 'processing', 'saving']) test(`no new capture while ${busy}`, async () => {
  status = busy; let view!: ReactTestRenderer; await act(async () => { view = create(<Harness />); });
  await act(async () => { await start(); target.dispatchEvent(new Event('start-recording-from-sidebar')); await tick(); });
  expect(started).toHaveBeenCalledTimes(0); expect(status).toBe(busy); act(() => view.unmount());
});
test('native start queued during navigation is consumed once', async () => {
  storage.set('autoStartRecording', 'true'); let view!: ReactTestRenderer; await act(async () => { view = create(<Harness />); await tick(); });
  expect(storage.has('autoStartRecording')).toBe(false); expect(started).toHaveBeenCalledTimes(1); act(() => view.unmount());
});
