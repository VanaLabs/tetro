import { LANGUAGES } from '@/constants/languages';
import { canonicalModelName } from './parakeet';

/** Keep the picker and ready screen in sync, including fixed-language model overrides. */
export function recordingLanguageCode(provider: string, model: string, selected: string) {
  if (provider === 'parakeet') {
    const id = canonicalModelName(model);
    if (id === 'stt-fastconformer-armenian') return 'hy';
    if (id === 'stt-parakeet-english') return 'en';
  }
  return selected;
}

export function recordingLanguageLabel(provider: string, model: string, selected: string) {
  const code = recordingLanguageCode(provider, model, selected);
  return LANGUAGES.find(language => language.code === code)?.name ?? 'Detect automatically';
}
