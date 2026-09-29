'use client';
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { discardTranscriptDraft } from '@/lib/transcript-draft';

type Receipt = { id: string; meeting_id: string; transcript_ids: string; parts: string };
export function DeletedDraftCleanup() {
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let rerun = false;
    const clean = async () => {
      if (stopped) return;
      if (busy) { rerun = true; return; }
      busy = true;
      try {
        const rows = await invoke<Receipt[]>('api_pending_local_cleanup');
        for (const row of rows) {
          const parts = JSON.parse(row.parts);
          if (parts.transcript) {
            for (const id of JSON.parse(row.transcript_ids) as string[]) {
              // Remove directly first so storage failures leave the receipt pending.
              localStorage.removeItem(`tetro.transcriptDraft.${id}`);
              discardTranscriptDraft(id);
            }
          }
          if (parts.summary) {
            localStorage.removeItem(`tetro.summaryDraft.${row.meeting_id}`);
            localStorage.removeItem(`tetro.instructions.${row.meeting_id}`);
          }
          await invoke('api_ack_local_cleanup', { id: row.id });
        }
      } catch { /* Retry when returning to the app; receipt survives restarts. */ }
      finally { busy = false; if (rerun) { rerun = false; void clean(); } }
    };
    const off = listen('tetro-local-cleanup', () => { void clean(); });
    void clean();
    window.addEventListener('focus', clean);
    return () => { stopped = true; window.removeEventListener('focus', clean); void off.then(fn => fn()); };
  }, []);
  return null;
}
