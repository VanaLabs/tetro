import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';

export type RecordingInput = 'microphone' | 'system';
export type RecordingInputs = { microphone_muted: boolean; system_muted: boolean; revision: number };
const INITIAL: RecordingInputs = { microphone_muted: false, system_muted: false, revision: -1 };

/** Backend-confirmed input choices survive navigation and a frontend reload. */
export function useRecordingInputs() {
  const [inputs, setInputs] = useState(INITIAL);
  const [pending, setPending] = useState({ microphone: false, system: false });
  const inFlight = useRef(new Set<RecordingInput>());
  const mounted = useRef(false);
  const accept = useCallback((next: RecordingInputs) => {
    if (!mounted.current) return;
    setInputs(previous => next.revision >= previous.revision ? next : previous);
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const off = await listen<RecordingInputs>('recording-inputs-changed', e => { if (!disposed) accept(e.payload); });
        if (disposed) { off(); return; }
        unlisten = off;
        const current = await invoke<RecordingInputs>('get_recording_inputs');
        if (!disposed) accept(current);
      } catch (error) {
        if (!disposed) toast.error('Audio controls unavailable', { description: String(error) });
      }
    })();
    return () => { disposed = true; mounted.current = false; unlisten?.(); };
  }, [accept]);

  const setMuted = useCallback(async (input: RecordingInput, muted: boolean) => {
    if (inFlight.current.has(input)) return;
    inFlight.current.add(input);
    setPending(previous => ({ ...previous, [input]: true }));
    try {
      accept(await invoke<RecordingInputs>('set_recording_input_muted', { input, muted }));
    } catch (error) {
      if (mounted.current) toast.error(`Couldn’t ${muted ? 'mute' : 'unmute'} ${input === 'microphone' ? 'microphone' : 'computer audio'}`, { description: String(error) });
    } finally {
      inFlight.current.delete(input);
      if (mounted.current) setPending(previous => ({ ...previous, [input]: false }));
    }
  }, [accept]);

  return { inputs, inputControlsReady: inputs.revision >= 0, inputPending: pending, setInputMuted: setMuted };
}
