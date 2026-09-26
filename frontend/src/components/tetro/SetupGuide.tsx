'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';

const DISMISS_KEY = 'tetro.setupGuideDismissed';
type Status = { transcription: boolean; notes: boolean };

async function hasTranscriptionModel() {
  const config = await invoke<{ provider?: string } | null>('api_get_transcript_config').catch(() => null);
  const provider = config?.provider === 'parakeet' ? 'parakeet' : 'whisper';
  try {
    await invoke(`${provider}_init`);
    const models = await invoke<{ status: unknown }[]>(`${provider}_get_available_models`);
    return models.some(m => m.status === 'Available');
  } catch { return false; }
}

async function hasNotesModel() {
  const config = await invoke<{ provider?: string; model?: string } | null>('api_get_model_config').catch(() => null);
  if (!config?.provider || !config.model) return false;
  if (['builtin-ai', 'local-llama', 'localllama'].includes(config.provider)) {
    return invoke<boolean>('builtin_ai_is_model_ready', { modelName: config.model, refresh: false }).catch(() => false);
  }
  return true;
}

/** A dismissible checklist on Home that points new users at the two models Tetro needs. Never blocks the app. */
export function SetupGuide({ onChooseTranscription }: { onChooseTranscription: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(true);

  const check = useCallback(async () => {
    const [transcription, notes] = await Promise.all([hasTranscriptionModel(), hasNotesModel()]);
    setStatus({ transcription, notes });
  }, []);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1'); } catch { setDismissed(false); }
    void check();
    // Re-check when a download finishes or the model choice changes elsewhere.
    const events = ['model-config-updated', 'parakeet-model-download-complete', 'model-download-complete', 'ollama-model-download-complete'];
    const unlisten = events.map(e => listen(e, () => void check()));
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => { unlisten.forEach(p => p.then(fn => fn()).catch(() => {})); window.removeEventListener('focus', onFocus); };
  }, [check]);

  if (dismissed || !status || (status.transcription && status.notes)) return null;
  const dismiss = () => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch {} };
  const openNotesSettings = () => { sessionStorage.setItem('tetro.settingsTab', 'summaryModels'); router.push('/settings'); };

  return <section className="tetro-setup" aria-label="Set up Tetro">
    <div className="tetro-setup-head">
      <b>Two downloads and you’re ready</b>
      <button className="tetro-icon" onClick={dismiss} aria-label="Hide setup tips" title="Hide setup tips"><X /></button>
    </div>
    <ol>
      <li data-done={status.transcription || undefined}>
        <i aria-hidden="true">{status.transcription ? <Check /> : '1'}</i>
        <span><b>Transcription model</b><small>Turns speech into text on this device.</small></span>
        {!status.transcription && <button className="tetro-key tetro-key-amber" onClick={onChooseTranscription}>Choose model</button>}
      </li>
      <li data-done={status.notes || undefined}>
        <i aria-hidden="true">{status.notes ? <Check /> : '2'}</i>
        <span><b>Summary model</b><small>Writes meeting summaries. Optional; you can record without it.</small></span>
        {!status.notes && <button className="tetro-key" onClick={openNotesSettings}>Choose model</button>}
      </li>
    </ol>
  </section>;
}
