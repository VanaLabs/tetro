'use client';

import { subscribePendingMarks } from '@/lib/marks';
import { DeckMeter } from '@/components/tetro/RecordingLevels';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Pause, Play, Bookmark, Square, Circle } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';

import { useRecordingState } from '@/contexts/RecordingStateContext';
import type { TranscriptionErrorPayload } from '@/services/transcriptService';

interface RecordingControlsProps {
  isRecording: boolean;
  onRecordingStop: (callApi?: boolean) => Promise<void>;
  onRecordingStart: () => Promise<void>;
  onTranscriptionError?: (message: string) => void;
  onStopInitiated?: () => void; // Called immediately when stop button is clicked
  isRecordingDisabled: boolean;
  isParentProcessing: boolean;
  meetingName?: string;
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  onRecordingStop,
  onRecordingStart,
  onTranscriptionError,
  onStopInitiated,
  isRecordingDisabled,
  isParentProcessing,
  meetingName,
}) => {
  // Use global recording state context for pause state (syncs with tray operations)
  const recordingState = useRecordingState();
  const isPaused = recordingState.isPaused;
  const isStartingRecording = recordingState.isStartingRecording;

  const [isProcessing, setIsProcessing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const stopInFlight = useRef(false);

  // Tape-counter readout: always two-digit minutes, hours only when needed.
  const formatTime = (time: number) => {
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60).toString().padStart(2, '0');
    const seconds = Math.floor(time % 60).toString().padStart(2, '0');
    return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
  };

  const stopRecordingAction = useCallback(async () => {
    console.log('Executing stop recording...');
    try {
      setIsProcessing(true);
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      console.log('Saving recording to:', savePath);
      console.log('About to call stop_recording command');
      const result = await invoke('stop_recording', {
        args: {
          save_path: savePath
        }
      });
      console.log('stop_recording command completed successfully:', result);
      setIsProcessing(false);
      // Track successful transcription

      await onRecordingStop(true);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
        if (error.message.includes('No recording in progress')) {
          return;
        }
      } else if (typeof error === 'string' && error.includes('No recording in progress')) {
        return;
      } else if (error && typeof error === 'object' && 'toString' in error) {
        if (error.toString().includes('No recording in progress')) {
          return;
        }
      }
      setIsProcessing(false);
      await onRecordingStop(false);
    } finally {
      setIsProcessing(false);
      stopInFlight.current = false;
      setIsStopping(false);
    }
  }, [onRecordingStop]);

  const handleStopRecording = useCallback(async () => {
    if (!isRecording || stopInFlight.current || isStartingRecording || recordingState.isStopping || isPausing || isResuming) return;
    stopInFlight.current = true;
    onStopInitiated?.();
    setIsStopping(true);
    await stopRecordingAction();
  }, [isRecording, isStartingRecording, recordingState.isStopping, isPausing, isResuming, stopRecordingAction, onStopInitiated]);

  const handlePauseRecording = useCallback(async () => {
    if (!isRecording || isPaused || isPausing) return;

    console.log('Pausing recording...');
    setIsPausing(true);

    try {
      await invoke('pause_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording paused successfully');
    } catch (error) {
      console.error('Failed to pause recording:', error);
      toast.error('Couldn’t pause recording', { description: 'Recording continues. Try again.' });
    } finally {
      setIsPausing(false);
    }
  }, [isRecording, isPaused, isPausing]);

  const handleResumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused || isResuming) return;

    console.log('Resuming recording...');
    setIsResuming(true);

    try {
      await invoke('resume_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording resumed successfully');
    } catch (error) {
      console.error('Failed to resume recording:', error);
      toast.error('Couldn’t resume recording', { description: 'Recording is still paused. Try again.' });
    } finally {
      setIsResuming(false);
    }
  }, [isRecording, isPaused, isResuming]);

  useEffect(() => {
    console.log('Setting up recording event listeners');
    let unsubscribes: (() => void)[] = [];
    let disposed = false;

    const setupListeners = async () => {
      try {
        // Transcript error listener - handles both regular and actionable errors
        const transcriptErrorUnsubscribe = await listen('transcript-error', (event) => {
          console.log('transcript-error event received:', event);
          console.error('Transcription error received:', event.payload);
          const errorMessage = event.payload as string;

          console.log('Tracked transcription error:', errorMessage);

          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcript error');
          onRecordingStop(false);
          if (onTranscriptionError) {
            onTranscriptionError(errorMessage);
          }
        });

        // Transcription error listener - handles structured error objects with actionable flag
        const transcriptionErrorUnsubscribe = await listen<TranscriptionErrorPayload>('transcription-error', (event) => {
          console.log('transcription-error event received:', event);
          console.error('Transcription error received:', event.payload);

          const errorMessage = event.payload.userMessage || event.payload.error;

          console.log('Tracked transcription error:', errorMessage);

          setIsProcessing(false);

          if (event.payload.phase === 'active') {
            console.log('Calling onRecordingStop(false) due to active transcription error');
            onRecordingStop(false);
          }

          // For actionable errors (like model loading failures), the main page will handle showing the model selector
          // For regular errors, they are handled by useModalState global listener which shows a toast
        });

        // Pause/Resume events are now handled by RecordingStateContext
        // No need for duplicate listeners here

        unsubscribes = [transcriptErrorUnsubscribe, transcriptionErrorUnsubscribe];
        if (disposed) unsubscribes.forEach(unsubscribe => unsubscribe());
        console.log('Recording event listeners set up successfully');
      } catch (error) {
        console.error('Failed to set up recording event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      disposed = true;
      unsubscribes.forEach(unsubscribe => {
        if (unsubscribe && typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [onRecordingStop, onTranscriptionError]);

  const seconds = Math.floor(recordingState.activeDuration ?? recordingState.recordingDuration ?? 0);
  const [markCount, setMarkCount] = useState(0);
  useEffect(() => subscribePendingMarks(marks => setMarkCount(marks.length)), []);
  const finishing = isStopping || recordingState.isStopping || isProcessing || isParentProcessing || recordingState.isSaving;
  const busy = finishing || isStartingRecording;
  const status = recordingState.isSaving ? 'Saving…' : isParentProcessing ? 'Finishing transcript…' : finishing ? 'Stopping…' : isStartingRecording ? 'Starting…' : isRecording ? (isPaused ? 'Paused' : 'Recording') : 'Ready';
  const mainLabel = finishing ? 'Saving…' : isStartingRecording ? 'Starting…' : isRecording ? 'Stop' : 'Record';
  const marquee = isRecording ? `${meetingName?.trim() || 'Untitled recording'}  —  ${isPaused ? 'paused' : 'recording'}  —  ` : 'Tetro  —  ready when you are  —  ';
  return <>
    <div className="tetro-keybank" role="group" aria-label="Recorder">
      <button type="button" className="tetro-key tetro-key-amber tetro-record-action" aria-label={busy ? mainLabel : isRecording ? 'Stop and save recording' : 'Start recording'} aria-busy={busy} onClick={() => { void (isRecording ? handleStopRecording() : onRecordingStart()); }} disabled={busy || isPausing || isResuming || (!isRecording && isRecordingDisabled)}>
        {isRecording || finishing ? <Square fill="currentColor" aria-hidden="true" /> : <Circle fill="currentColor" aria-hidden="true" />}<span>{mainLabel}</span>
      </button>
      <button type="button" className="tetro-key tetro-pause-action" data-latched={isRecording && isPaused || undefined} aria-label={isPaused ? 'Resume recording' : 'Pause recording'} onClick={() => { void (isPaused ? handleResumeRecording() : handlePauseRecording()); }} disabled={!isRecording || busy || isPausing || isResuming}>
        {isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}<span>{isPaused ? 'Resume' : 'Pause'}</span>
      </button>
      <button type="button" className="tetro-key" aria-label="Highlight this moment" title="Highlight this moment" onClick={() => window.dispatchEvent(new Event('tetro:mark-moment'))} disabled={!isRecording || busy}><Bookmark aria-hidden="true" /><span>Highlight</span></button>
    </div>
    <div className="tetro-deck" data-state={busy ? 'busy' : isRecording ? (isPaused ? 'paused' : 'recording') : 'idle'}>
      <div className="tetro-lcd">
        <div className="tetro-lcd-time"><span className="tetro-lcd-mode" aria-hidden="true">{isRecording ? (isPaused ? '❚❚' : '●') : '■'}</span><time aria-label={`Recorded ${formatTime(seconds)}`}>{formatTime(seconds)}</time></div>
        <div className="tetro-lcd-info">
          <div className="tetro-marquee" aria-hidden="true"><span>{marquee}</span><span>{marquee}</span></div>
          <div className="tetro-lcd-tags"><i className="tetro-lamp" aria-hidden="true" /><span className="tetro-transport-status" role="status">{status}</span><i className="tetro-lcd-tag">48kHz</i>{markCount > 0 && <i className="tetro-lcd-tag is-marks" title={`${markCount} marked ${markCount === 1 ? 'moment' : 'moments'}`}>◆ {markCount}</i>}<i className="tetro-lcd-tag" data-on={isRecording || undefined}>Rec</i></div>
        </div>
      </div>
      <DeckMeter active={isRecording && !isPaused} />
    </div>
  </>;
};
