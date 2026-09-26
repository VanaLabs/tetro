'use client';

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { RecordingStatus, useRecordingState } from './RecordingStateContext';
import { listen } from '@tauri-apps/api/event';
import { useRecordingStop } from '@/hooks/useRecordingStop';

/**
 * RecordingPostProcessingProvider
 *
 * This provider handles post-processing when recording stops from any source:
 * - Tray menu stop
 * - Global keyboard shortcut
 * - Overlay stop button
 * - Main UI stop button
 *
 * It listens for the 'recording-stop-complete' event from Rust backend
 * and triggers the full post-processing flow (save to database, navigate)
 * regardless of which page the user is currently on.
 */
export function RecordingPostProcessingProvider({ children }: { children: React.ReactNode }) {
  const recording = useRecordingState();
  const state = useRef(recording); state.current = recording;
  const [quitOpen, setQuitOpen] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [quitError, setQuitError] = useState('');
  const quitAfterSave = useRef(false);
  useEffect(() => {
    const off = listen<string>('tetro-file-sync-error', event => toast.warning(event.payload));
    return () => { void off.then(fn => fn()); };
  }, []);
  useEffect(() => {
    const off = listen<{ pendingSave: boolean }>('tetro-quit-requested', async event => {
      if (!event.payload.pendingSave && !state.current.isRecording) {
        try { await invoke('api_finish_quit'); }
        catch (e) { setQuitError(String(e)); setQuitOpen(true); }
      } else { setQuitOpen(true); }
    });
    return () => { void off.then(fn => fn()); };
  }, []);
  useEffect(() => {
    if (!quitAfterSave.current) return;
    if (recording.status === RecordingStatus.COMPLETED) {
      quitAfterSave.current = false;
      void invoke('api_finish_quit').catch(e => { setQuitError(String(e)); setQuitting(false); });
    } else if (recording.status === RecordingStatus.ERROR) {
      quitAfterSave.current = false; setQuitting(false);
      setQuitError('Your recording could not be saved yet. Keep Tetro open and try saving again.');
    }
  }, [recording.status]);
  const stopAndQuit = async () => {
    quitAfterSave.current = true; setQuitting(true); setQuitError('');
    if ([RecordingStatus.STOPPING, RecordingStatus.PROCESSING_TRANSCRIPTS, RecordingStatus.SAVING].includes(state.current.status)) return;
    try { await invoke('api_stop_for_quit'); }
    catch (e) { quitAfterSave.current = false; setQuitting(false); setQuitError(String(e)); }
  };

  // No-op functions since the global RecordingStateContext already handles state updates
  // These are only needed for the hook's local component state management
  const setIsRecording = () => { };
  const setIsRecordingDisabled = () => { };

  const {
    handleRecordingStop,
  } = useRecordingStop(setIsRecording, setIsRecordingDisabled);

  const stopHandler = useRef(handleRecordingStop);
  stopHandler.current = handleRecordingStop;
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      try {
        // Listen for recording-stop-complete event from Rust
        unlistenFn = await listen<boolean>('recording-stop-complete', (event) => {
          console.log('[RecordingPostProcessing] Received recording-stop-complete event:', event.payload);

          // Call the post-processing handler
          // event.payload is the callApi boolean (true for normal stops)
          if (!cancelled) void stopHandler.current(event.payload);
        });

        if (cancelled) { unlistenFn(); return; }
        console.log('[RecordingPostProcessing] Event listener set up successfully');
      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up event listener:', error);
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      if (unlistenFn) {
        console.log('[RecordingPostProcessing] Cleaning up event listener');
        unlistenFn();
      }
    };
  }, []);

  return <>{children}<Dialog open={quitOpen} onOpenChange={open => { if (!quitting) setQuitOpen(open); }}><DialogContent>
    <DialogTitle>{quitting ? 'Saving before quitting…' : 'Save this recording before quitting?'}</DialogTitle>
    <DialogDescription>{quitting ? 'Tetro will close after your audio, transcript and important moments are saved.' : 'Your recording is still open. Stop and save it, or keep Tetro open.'}</DialogDescription>
    {quitError && <p role="alert">{quitError}</p>}
    <div className="tetro-dialog-actions">
      <button disabled={quitting} onClick={() => setQuitOpen(false)}>{recording.isRecording ? 'Keep recording' : 'Keep Tetro open'}</button>
      <button className="tetro-key tetro-key-amber" disabled={quitting} onClick={() => void stopAndQuit()}>{quitting ? 'Saving…' : 'Stop and save'}</button>
    </div>
  </DialogContent></Dialog></>;
}
