'use client';

import { useEffect, useRef } from 'react';
import { Mic, MicOff, Monitor, MonitorOff } from 'lucide-react';
import type { RecordingInput } from '@/hooks/useRecordingInputs';
import { useRecordingLevels, type AudioLevels } from '@/hooks/useRecordingLevels';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { addPendingMark, clearPendingMarks } from '@/lib/marks';

const DOTS = 16;

/** Microphone and computer meters stay visible at every recorder width. */
export function DeckMeter({ active, disabled = false }: { active: boolean; disabled?: boolean }) {
  const levels = useRecordingLevels(active);
  const { inputs, inputControlsReady, inputPending, setInputMuted } = useRecordingState();
  const row = (input: RecordingInput, value: number, label: string, icon: React.ReactNode, mutedIcon: React.ReactNode) => {
    const muted = input === 'microphone' ? inputs.microphone_muted : inputs.system_muted;
    const level = muted ? 0 : value;
    return <div className="tetro-meter-channel" data-muted={muted || undefined}>
      <button type="button" className="tetro-input-toggle" aria-label={`${label} mute`} aria-pressed={muted}
        title={`${muted ? 'Unmute' : 'Mute'} ${label.toLowerCase()} in this recording`}
        disabled={disabled || !inputControlsReady || inputPending[input]} aria-busy={inputPending[input]}
        onClick={() => { void setInputMuted(input, !muted); }}>{muted ? mutedIcon : icon}</button>
      <div className="tetro-meter-row" aria-label={`${label} level`} aria-valuetext={muted ? 'Muted' : undefined} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
        {Array.from({ length: DOTS }, (_, i) => <i key={i} data-on={active && i < Math.round(level * DOTS) || undefined} data-hot={i >= DOTS - 3 || undefined} />)}
      </div>
    </div>;
  };
  return <div className={`tetro-grille ${active ? 'is-live' : ''}`}>
    {row('microphone', levels.mic, 'Microphone', <Mic aria-hidden="true" />, <MicOff aria-hidden="true" />)}
    {row('system', levels.system, 'Computer audio', <Monitor aria-hidden="true" />, <MonitorOff aria-hidden="true" />)}
  </div>;
}

const SILENCE_MS = 60_000;
const HEARD = 0.004; // about -48 dB

/** App-wide: warns once when nothing has been heard for a minute while recording. */
export function SilenceWatch() {
  const { isRecording, isPaused, inputs } = useRecordingState();
  const allMuted = inputs.microphone_muted && inputs.system_muted;
  const lastHeard = useRef(Date.now());
  const warned = useRef(false);

  useEffect(() => {
    if (!isRecording || isPaused || allMuted) { lastHeard.current = Date.now(); return; }
    lastHeard.current = Date.now();
    const off = listen<AudioLevels>('recording-levels', e => {
      if (Math.max(e.payload.mic, e.payload.system) < HEARD) return;
      lastHeard.current = Date.now();
      if (warned.current) { warned.current = false; toast.dismiss('tetro-silence'); }
    });
    const timer = window.setInterval(() => {
      if (warned.current || Date.now() - lastHeard.current < SILENCE_MS) return;
      warned.current = true;
      toast.warning('Nothing heard for a minute', { id: 'tetro-silence', duration: Infinity, description: 'Check that your microphone is on and not muted. Recording continues.' });
      if (!document.hasFocus()) {
        import('@tauri-apps/plugin-notification')
          .then(({ sendNotification }) => sendNotification({ title: 'Tetro hears nothing', body: 'No sound for a minute. Check your microphone. Recording continues.' }))
          .catch(() => {});
      }
    }, 5000);
    return () => { void off.then(fn => fn()); window.clearInterval(timer); toast.dismiss('tetro-silence'); warned.current = false; };
  }, [isRecording, isPaused, allMuted]);
  return null;
}

/** App-wide: ⌥⌘M (or the recorder's Mark key) marks the current moment of the recording. */
export function MarkWatch() {
  const { isRecording, activeDuration, recordingDuration } = useRecordingState();
  const elapsed = useRef(0);
  elapsed.current = activeDuration ?? recordingDuration ?? 0;
  const recording = useRef(false);
  recording.current = isRecording;
  useEffect(() => {
    const off = listen('mark-moment', () => markMoment(recording.current, elapsed.current));
    const onLocal = () => markMoment(recording.current, elapsed.current);
    window.addEventListener('tetro:mark-moment', onLocal);
    return () => { void off.then(fn => fn()); window.removeEventListener('tetro:mark-moment', onLocal); };
  }, []);
  useEffect(() => { if (!isRecording) return; clearPendingMarks(); }, [isRecording]);
  return null;
}

function markMoment(isRecording: boolean, seconds: number) {
  if (!isRecording) { toast('Start a recording to mark moments', { id: 'tetro-mark', duration: 2000 }); return; }
  const at = Math.floor(seconds);
  const label = `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;
  if (addPendingMark(at)) toast.success(`Marked ${label}`, { id: 'tetro-mark', duration: 1800, description: 'The summary will cover this moment.' });
}
