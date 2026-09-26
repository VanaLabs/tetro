import { invoke } from '@tauri-apps/api/core';
import type { ModelConfig } from '@/components/ModelSettingsModal';

export const PROVIDER_LABELS: Record<string, string> = {
  'builtin-ai': 'Built-in', ollama: 'Ollama', openrouter: 'OpenRouter', claude: 'Claude',
  openai: 'OpenAI', groq: 'Groq', 'custom-openai': 'Custom server',
};

/** The saved summary model, or null when none is set. */
export async function loadSummaryModel(): Promise<ModelConfig | null> {
  const data = await invoke<ModelConfig | null>('api_get_model_config');
  return data && data.provider ? data : null;
}

/**
 * Saves a change to the summary model, keeping every field the change doesn't mention (the Ollama
 * address lives in the same row). Tells the rest of the app through model-config-updated.
 */
export async function saveSummaryModel(change: Partial<ModelConfig>, apiKey?: string | null): Promise<ModelConfig> {
  const current = await loadSummaryModel();
  const next = {
    provider: 'builtin-ai', model: '', whisperModel: 'large-v3', ollamaEndpoint: null,
    ...current, ...change,
    apiKey: apiKey ?? (current?.provider === (change.provider ?? current?.provider) ? current?.apiKey : null) ?? null,
  } as ModelConfig;
  await invoke('api_save_model_config', {
    provider: next.provider, model: next.model, whisperModel: next.whisperModel || 'large-v3',
    apiKey: apiKey ?? null, ollamaEndpoint: next.ollamaEndpoint ?? null,
  });
  const { emit } = await import('@tauri-apps/api/event');
  await emit('model-config-updated', next).catch(() => console.warn('Model saved; another open view could not be refreshed.'));
  return next;
}
