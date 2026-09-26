import { resolveTranscriptionRoute } from './transcription-language-routing';
export function modelUseNote(provider: string, model: string, selected: boolean): string {
  if (selected && provider === 'parakeet' && model === 'stt-fastconformer-armenian') return 'Currently used for Armenian transcription.';
  if (provider === 'builtin-ai') return selected ? 'Currently used for notes.' : '';
  const languages = [['en', 'English'], ['ru', 'Russian'], ['hy', 'Armenian']].filter(([code]) => {
    const route = resolveTranscriptionRoute(code);
    return route.kind === 'switch' && route.provider === provider && route.model === model;
  }).map(([, name]) => name);
  return languages.length ? `Used for ${languages.join(' and ')}.` : selected ? 'Currently used for transcription.' : '';
}
