import { invoke } from '@tauri-apps/api/core';
import { saveSummaryModel } from './summaryModel';
import type { ModelConfig } from '@/components/ModelSettingsModal';

export type LocalModelProvider = 'localWhisper' | 'parakeet' | 'builtin-ai' | 'ollama';
export const TRANSCRIBER_CHANGED = 'tetro:transcriber-changed';
const pending = new Map<string, string>();
const purpose = (provider: LocalModelProvider) => provider === 'builtin-ai' || provider === 'ollama' ? 'notes' : 'transcription';

// Last explicit choice wins. Download completion in another screen must never
// silently switch the current model. This intent lasts while the app is open.
export function requestModelActivation(provider: LocalModelProvider, model: string) {
  pending.set(purpose(provider), `${provider}:${model}`);
}
export function cancelModelActivation(provider: LocalModelProvider, model: string) {
  if (pending.get(purpose(provider)) === `${provider}:${model}`) pending.delete(purpose(provider));
}
let saving: Promise<unknown> = Promise.resolve();
export async function activateModel(provider: LocalModelProvider, model: string) {
  pending.delete(purpose(provider));
  const work = saving.catch(() => {}).then(() => saveModel(provider, model));
  saving = work;
  return work;
}
async function saveModel(provider: LocalModelProvider, model: string) {
  if (!model) return;
  if (provider === 'builtin-ai' || provider === 'ollama') await saveSummaryModel({ provider, model });
  else {
    const config = { provider, model, apiKey: null };
    await invoke('api_save_transcript_config', config);
    window.dispatchEvent(new CustomEvent(TRANSCRIBER_CHANGED, { detail: config }));
  }
}
export async function activateDownloadedModel(provider: LocalModelProvider, model: string) {
  if (pending.get(purpose(provider)) !== `${provider}:${model}`) return false;
  await activateModel(provider, model);
  return true;
}

/** Explicit choices from any notes provider supersede pending local downloads. */
export function activateNotesModel(change: Partial<ModelConfig>, apiKey?: string | null): Promise<ModelConfig> {
  pending.delete('notes');
  const work = saving.catch(() => {}).then(() => saveSummaryModel(change, apiKey));
  saving = work;
  return work;
}
