'use client';
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';
import { activateDownloadedModel, cancelModelActivation, LocalModelProvider, TRANSCRIBER_CHANGED } from '@/lib/model-activation';

/** Keep a requested Download and use working when the person leaves Settings. */
export function ModelActivationBridge() {
  const { setTranscriptModelConfig } = useConfig();
  useEffect(() => {
    const changed = (event: Event) => setTranscriptModelConfig((event as CustomEvent).detail);
    window.addEventListener(TRANSCRIBER_CHANGED, changed);
    let disposed = false;
    const off: (() => void)[] = [];
    const complete = async (provider: LocalModelProvider, model: string) => {
      try { if (await activateDownloadedModel(provider, model)) toast.success(provider === 'builtin-ai' ? 'Ready to write notes' : 'Ready to transcribe', { description: `${model} is now in use.` }); }
      catch (error) { toast.error('Downloaded, but couldn’t switch models', { description: 'Your previous model is still selected. Choose Use to try again.' }); }
    };
    const add = async <T,>(name: string, callback: (payload: T) => void) => {
      const unlisten = await listen<T>(name, e => callback(e.payload));
      if (disposed) unlisten(); else off.push(unlisten);
    };
    void Promise.all([
      add<{ modelName: string }>('model-download-complete', e => { void complete('localWhisper', e.modelName); }),
      add<{ modelName: string }>('parakeet-model-download-complete', e => { void complete('parakeet', e.modelName); }),
      add<{ model: string; status: string }>('builtin-ai-download-progress', e => {
        if (e.status === 'completed') void complete('builtin-ai', e.model);
        if (e.status === 'cancelled' || e.status === 'error') cancelModelActivation('builtin-ai', e.model);
      }),
    ]).catch(() => toast.error('Couldn’t watch model downloads', { description: 'After downloading, choose Use in Models.' }));
    return () => { disposed = true; off.forEach(fn => fn()); window.removeEventListener(TRANSCRIBER_CHANGED, changed); };
  }, [setTranscriptModelConfig]);
  return null;
}
