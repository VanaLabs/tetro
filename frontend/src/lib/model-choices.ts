import { readModelCatalog as read } from './model-catalog-read';
import type { ModelConfig } from '@/components/ModelSettingsModal';
import { getModelDisplayName } from './parakeet';
import { getWhisperDisplayName } from './whisper';
import { summaryDisplayName } from './model-display';
import { notesDestination } from './model-privacy';
import { PROVIDER_LABELS } from './summaryModel';

export type ModelPurpose = 'transcription' | 'notes';
export type ModelProvider = ModelConfig['provider'] | 'localWhisper' | 'parakeet';
export type ModelChoice = { provider: ModelProvider; model: string; label: string; detail: string; config?: Partial<ModelConfig> };
export type ModelSource = { id: ModelProvider; label: string; optional?: boolean; load: () => Promise<ModelChoice[]> };
export type SourceState = { source: ModelSource; options: ModelChoice[]; status: 'loading' | 'ready' | 'error' };

export function modelLabel(provider: string, model: string) {
  const notes = model.match(/^(qwen|gemma)([0-9.]+):(\d+)b$/i);
  if (provider === 'builtin-ai') return summaryDisplayName(model);
  if (notes && provider === 'ollama') return `${notes[1][0].toUpperCase()}${notes[1].slice(1)} ${notes[2]} ${notes[3]}B`;
  return provider === 'parakeet' ? getModelDisplayName(model) : provider === 'localWhisper' ? getWhisperDisplayName(model) : model;
}

export function modelSources(purpose: ModelPurpose, keys: Record<string, boolean>, endpoint?: string | null, currentProvider?: string): ModelSource[] {
  if (purpose === 'transcription') return (['parakeet', 'localWhisper'] as const).map(provider => ({
    id: provider, label: provider === 'parakeet' ? 'Parakeet transcription' : 'Whisper transcription',
    load: async () => (await read<{ name: string; status: unknown }[]>(provider === 'parakeet' ? 'parakeet_get_available_models' : 'whisper_get_available_models'))
      .filter(m => m.status === 'Available').map(m => ({ provider, model: m.name, label: modelLabel(provider, m.name), detail: 'Transcription · Stays on this device' })),
  }));
  const providers: ModelConfig['provider'][] = ['builtin-ai', 'ollama', 'custom-openai', ...(['openrouter', 'claude', 'openai', 'groq'] as const).filter(p => keys[p])];
  return providers.map(provider => ({ id: provider, label: PROVIDER_LABELS[provider], optional: provider === 'ollama' && !endpoint && currentProvider !== 'ollama', load: async () => {
    const option = (model: string, label = model): ModelChoice => ({ provider, model, label, detail: notesDestination(provider, endpoint) });
    switch (provider) {
      case 'builtin-ai': return (await read<{ name: string; display_name: string; status: { type: string } }[]>('builtin_ai_list_models')).filter(m => m.status.type === 'available').map(m => option(m.name, summaryDisplayName(m.name, m.display_name)));
      case 'ollama': return (await read<{ name: string }[]>('get_ollama_models', { endpoint: endpoint || null })).map(m => option(m.name));
      case 'custom-openai': {
        const c = await read<{ endpoint?: string; model?: string; hasApiKey?: boolean; displayName?: string; maxTokens?: number; temperature?: number; topP?: number } | null>('api_get_custom_openai_config');
        return c?.endpoint && c.model ? [{ ...option(c.model, c.displayName || c.model), detail: notesDestination(provider, c.endpoint), config: { customOpenAIEndpoint: c.endpoint, customOpenAIModel: c.model, customOpenAIApiKey: null, maxTokens: c.maxTokens, temperature: c.temperature, topP: c.topP } }] : [];
      }
      case 'openrouter': return (await read<{ id: string; name?: string }[]>('get_openrouter_models')).map(m => option(m.id, m.name));
      case 'claude': return (await read<{ id: string; display_name?: string }[]>('get_anthropic_models', { apiKey: null })).map(m => option(m.id, m.display_name));
      default: return (await read<{ id: string }[]>(provider === 'openai' ? 'get_openai_models' : 'get_groq_models', { apiKey: null })).map(m => option(m.id));
    }
  } }));
}

/** Deliver each source independently, bound waiting time, and ignore results after a chooser closes. */
export function loadModelSources(sources: ModelSource[], update: (state: SourceState) => void, timeoutMs = 8000) {
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  for (const source of sources) {
    update({ source, options: [], status: 'loading' });
    let finished = false;
    const finish = (options: ModelChoice[], status: 'ready' | 'error') => {
      if (disposed || finished) return;
      finished = true; clearTimeout(timer); timers.delete(timer); update({ source, options, status: status === 'error' && source.optional ? 'ready' : status });
    };
    const timer = setTimeout(() => finish([], 'error'), timeoutMs);
    timers.add(timer);
    Promise.resolve().then(source.load).then(options => finish(options, 'ready'), () => finish([], 'error'));
  }
  return () => { disposed = true; timers.forEach(clearTimeout); timers.clear(); };
}
