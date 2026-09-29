'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { emit } from '@tauri-apps/api/event';
import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import { useRecordingLevels } from '@/hooks/useRecordingLevels';
import styles from './TetroBrand.module.css';

export type SignalState = 'idle' | 'starting' | 'recording' | 'paused' | 'processing' | 'error';
type SignalProps = { size?: number; state?: SignalState; level?: number; motion?: boolean; className?: string };

export function signalState(status: RecordingStatus, recording: boolean, paused: boolean): SignalState {
  if ([RecordingStatus.STOPPING, RecordingStatus.PROCESSING_TRANSCRIPTS, RecordingStatus.SAVING].includes(status)) return 'processing';
  if (status === RecordingStatus.ERROR) return 'error';
  if (recording) return paused ? 'paused' : 'recording';
  return status === RecordingStatus.STARTING ? 'starting' : 'idle';
}

function useMotionVisibility() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(!preference.matches && document.visibilityState !== 'hidden');
    update();
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => { preference.removeEventListener('change', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  return enabled;
}

/** Letter icon for places that need an app icon rather than the wordmark. */
export function TetroMark({ size = 32, state = 'idle', motion = true, className = '' }: SignalProps) {
  return <img src="/tetro/identity/app-icon.png" width={size} height={size} className={`${styles.icon} ${className}`} data-state={state} data-motion={motion ? 'on' : 'off'} alt="" />;
}

/** Uses the approved lettering rather than approximating it with an installed font. */
export function TetroWordmark({ className = '', bars = [] }: { className?: string; bars?: number[] }) {
  return <span className={`${styles.wordmark} ${className}`} aria-hidden="true">
    <span className={styles.gradient} />
    <span className={styles.signal}>{bars.map((value, index) => <i key={index} style={{ transform: `scaleY(${Math.min(.78, value * .78)})` }} />)}</span>
  </span>;
}

export function TetroBrand({ variant = 'sidebar', state = 'idle', level = 0, motion = true, bars = [] }: SignalProps & { variant?: 'sidebar' | 'about' | 'welcome' | 'onboarding'; bars?: number[] }) {
  return <span className={`${styles.lockup} ${styles[variant]}`} data-state={state} data-motion={motion ? 'on' : 'off'} style={{ '--brand-energy': level } as CSSProperties} aria-hidden="true">
    <TetroWordmark bars={bars} />
  </span>;
}

export function TetroLiveBrand({ variant = 'sidebar' }: { variant?: 'sidebar' | 'about' }) {
  const { status, isRecording, isPaused } = useRecordingState();
  const state = signalState(status, isRecording, isPaused);
  const motion = useMotionVisibility();
  const levels = useRecordingLevels(state === 'recording' && motion);
  return <TetroBrand variant={variant} state={state} level={Math.max(levels.mic, levels.system)} bars={levels.history} motion={motion} />;
}

/** Keeps native status and Reduce Motion in sync even when the sidebar is collapsed. */
export function TetroIdentityBridge() {
  const { status } = useRecordingState();
  const processing = [RecordingStatus.STOPPING, RecordingStatus.PROCESSING_TRANSCRIPTS, RecordingStatus.SAVING].includes(status);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const send = () => { void emit('tetro-brand-ui', { processing, reducedMotion: preference.matches }).catch(() => {}); };
    send();
    preference.addEventListener('change', send);
    return () => preference.removeEventListener('change', send);
  }, [processing]);
  return null;
}
