'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { TEXT_UPDATED } from '@/lib/meeting-edits';
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';

type Playback = { available: boolean; time: number; playing: boolean; seek: (seconds: number, play?: boolean) => void };
const PlaybackContext = createContext<Playback>({ available: false, time: 0, playing: false, seek: () => {} });
export const usePlayback = () => useContext(PlaybackContext);

const SPEEDS = [1, 1.25, 1.5, 2];
const clock = (s: number) => {
  if (!Number.isFinite(s)) return '--:--';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/** Loads the meeting's recording and shares playback state with the transcript. */
export function PlaybackProvider({ meetingId, children }: { meetingId?: string; children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const update = (event: Event) => { if ((event as CustomEvent).detail.meetingId === meetingId && (event as CustomEvent).detail.mediaChanged) { audio.current?.pause(); setRetry(n => n + 1); } };
    window.addEventListener(TEXT_UPDATED, update);
    return () => window.removeEventListener(TEXT_UPDATED, update);
  }, [meetingId]);

  useEffect(() => {
    setSrc(null); setFailed(false); setTime(0); setPlaying(false); setAudioError('');
    if (!meetingId) return;
    let cancelled = false;
    invoke<string | null>('api_meeting_audio_path', { meetingId })
      .then(path => { if (!cancelled && path) setSrc(convertFileSrc(path)); })
      .catch(() => { if (!cancelled) setAudioError('Couldn’t open the recording. Your transcript and notes are still available.'); });
    return () => { cancelled = true; };
  }, [meetingId, retry]);

  const seek = useCallback((seconds: number, play = true) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    setTime(el.currentTime);
    if (play) void el.play().catch(() => {});
  }, []);

  const toggle = () => { const el = audio.current; if (!el) return; if (el.paused) void el.play().catch(() => {}); else el.pause(); };
  const changeSpeed = () => { const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(next); if (audio.current) audio.current.playbackRate = next; };
  const available = !!src && !failed;
  const value = useMemo(() => ({ available, time, playing, seek }), [available, time, playing, seek]);

  return <PlaybackContext.Provider value={value}>
    {children}
    {audioError && <div className="tetro-player-error" role="alert"><span>{audioError}</span><button className="tetro-link" onClick={() => setRetry(n => n + 1)}>Try again</button><button className="tetro-link" onClick={() => { void invoke('open_meeting_folder', { meetingId }).catch(() => setAudioError('The recording folder is unavailable. The audio may have been moved or deleted; your transcript and notes are safe.')); }}>Open recording folder</button></div>}
    {src && !failed && <div className="tetro-player" role="group" aria-label="Recording playback">
      <audio ref={audio} src={src} preload="metadata"
        onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onError={() => { setFailed(true); setAudioError('This audio file couldn’t be played. It may have been moved or deleted.'); }} />
      <button className="tetro-player-btn" onClick={() => seek(time - 10, playing)} aria-label="Back 10 seconds" title="Back 10 seconds"><RotateCcw /></button>
      <button className="tetro-player-btn is-main" onClick={toggle} aria-label={playing ? 'Pause' : 'Play recording'} title={playing ? 'Pause' : 'Play recording'}>{playing ? <Pause /> : <Play />}</button>
      <button className="tetro-player-btn" onClick={() => seek(time + 10, playing)} aria-label="Forward 10 seconds" title="Forward 10 seconds"><RotateCw /></button>
      <time>{clock(time)}</time>
      <input type="range" className="tetro-player-track" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)}
        onChange={e => seek(Number(e.target.value), playing)} aria-label="Playback position"
        style={{ ['--p' as string]: duration ? `${(time / duration) * 100}%` : '0%' }} />
      <time>{clock(duration)}</time>
      <button className="tetro-player-speed" onClick={changeSpeed} aria-label={`Playback speed ${speed}×`} title="Playback speed">{speed}×</button>
    </div>}
  </PlaybackContext.Provider>;
}
