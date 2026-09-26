import { LANGUAGES } from '@/constants/languages';
import { canonicalModelName } from './parakeet';

/** Show the language the selected engine can actually hear, including fixed-language models. */
export function recordingLanguageLabel(provider: string, model: string, selected: string) {
  if (provider === 'parakeet') {
    const id = canonicalModelName(model);
    if (id === 'stt-fastconformer-armenian') return 'Armenian';
    if (id === 'stt-parakeet-english') return 'English';
    // Multilingual Parakeet detects its own language; it cannot be forced by a preference.
    return 'Detect automatically';
  }
  if (provider !== 'localWhisper') return 'Detect automatically';
  return LANGUAGES.find(language => language.code === selected)?.name ?? 'Detect automatically';
}
