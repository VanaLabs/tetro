'use client';

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { RecorderLoader } from '@/components/tetro/RecorderLoader';

type Job = { label: string; progress: number | null; stage?: string; message?: string };
export type RetranscribeStart = { meetingId: string; model: string; local: boolean };
export const RETRANSCRIBE_START = 'tetro:retranscribe-start';

const STAGE: Record<string, string> = { decoding: 'Reading audio', transcribing: 'Transcribing', saving: 'Saving', resampling: 'Preparing audio', vad: 'Finding speech' };

/** Retranscription shown inside the transcript pane: recorder animation, real progress, cancel. */
export function useRetranscription(meetingId: string | undefined, onDone: () => Promise<void> | void) {
  const [stopping, setStopping] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    if (!meetingId) return;
    const onStart = (e: Event) => {
      const d = (e as CustomEvent<RetranscribeStart>).detail;
      if (d.meetingId === meetingId) setJob({ label: `Retranscribing with ${d.model.replace(' · ', ' ')}${d.local ? ' on this device' : ''}`, progress: null });
    };
    window.addEventListener(RETRANSCRIBE_START, onStart);
    const offs = [
      listen<{ meeting_id: string; stage: string; progress_percentage: number; message: string }>('retranscription-progress', e => {
        if (e.payload.meeting_id !== meetingId) return;
        setJob(j => ({ label: j?.label ?? 'Retranscribing', progress: Math.min(1, e.payload.progress_percentage / 100), stage: STAGE[e.payload.stage] ?? e.payload.stage, message: e.payload.message.replace(/\s*\([\d.]+s\)/, '').replace(/\.\.\.$/, '') }));
      }),
      listen<{ meeting_id: string; segments_count: number }>('retranscription-complete', async e => {
        if (e.payload.meeting_id !== meetingId) return;
        setJob(null); setStopping(false);
        await done.current();
      }),
      listen<{ meeting_id: string; error: string }>('retranscription-error', e => {
        if (e.payload.meeting_id !== meetingId) return;
        setJob(null); setStopping(false);
        if (/cancel/i.test(e.payload.error)) toast('Transcription stopped. Your previous transcript is unchanged.');
        else toast.error('Transcription could not finish', { description: e.payload.error });
      }),
    ];
    return () => { window.removeEventListener(RETRANSCRIBE_START, onStart); offs.forEach(o => void o.then(fn => fn())); };
  }, [meetingId]);

  const cancel = async () => {
    setStopping(true);
    try { await invoke('cancel_retranscription_command'); }
    catch (e) { setStopping(false); toast.error(String(e)); }
  };
  const view = job ? <RecorderLoader progress={job.progress} label={job.label} detail={job.message ?? 'Local transcription can take a while for long recordings. You can keep using Tetro.'} stage={job.stage} stopping={stopping} onCancel={() => void cancel()} /> : null;
  return { active: !!job, view };
}
