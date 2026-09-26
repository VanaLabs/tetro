'use client';

import { useEffect, useRef } from 'react';
import { Mic, Monitor } from 'lucide-react';
import { useRecordingLevels, type AudioLevels } from '@/hooks/useRecordingLevels';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { addPendingMark, clearPendingMarks } from '@/lib/marks';

const DOTS = 16;

/** Microphone and computer meters stay visible at every recorder width. */
export function DeckMeter({ active }: { active: boolean }) {
  const levels = useRecordingLevels(active);
  const row = (value: number, label: string, icon: React.ReactNode) => <div className="tetro-meter-channel">
    <span className="tetro-meter-label" title={label}>{icon}<span>{label}</span></span>
    <div className="tetro-meter-row" aria-label={`${label} level`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      {Array.from({ length: DOTS }, (_, i) => <i key={i} data-on={active && i < Math.round(value * DOTS) || undefined} data-hot={i >= DOTS - 3 || undefined} />)}
    </div>
  </div>;
  return <div className={`tetro-grille ${active ? 'is-live' : ''}`}>
    {row(levels.mic, 'Microphone', <Mic aria-hidden="true" />)}
    {row(levels.system, 'Computer audio', <Monitor aria-hidden="true" />)}
  </div>;
}

const SILENCE_MS = 60_000;
const HEARD = 0.004; // about -48 dB

/** App-wide: warns once when nothing has been heard for a minute while recording. */
export function SilenceWatch() {
  const { isRecording, isPaused } = useRecordingState();
  const lastHeard = useRef(Date.now());
  const warned = useRef(false);

  useEffect(() => {
    if (!isRecording || isPaused) { lastHeard.current = Date.now(); return; }
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
  }, [isRecording, isPaused]);
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
