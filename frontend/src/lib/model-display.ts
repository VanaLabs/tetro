/** Display names only. Stored model IDs remain unchanged. */
const PARAKEET_NAMES: Record<string, string> = {
  'stt-parakeet-multilingual': 'Multilingual · Parakeet TDT 0.6B v3 · INT8',
  'stt-parakeet-english': 'English · Parakeet TDT 0.6B v2 · INT8',
  'stt-fastconformer-armenian': 'Armenian · NVIDIA FastConformer · INT8',
};

const WHISPER_NAMES: Record<string, string> = {
  'large-v3-turbo-hy': 'Armenian, English, Russian · Whisper Large v3 Turbo · tuned',
};

const SUMMARY_NAMES: Record<string, string> = {
  'qwen3.5:2b': 'Multilingual · Qwen 3.5 · 2B · Q4_K_M',
  'qwen3.5:4b': 'Multilingual · Qwen 3.5 · 4B · Q4_K_M',
  'gemma3:1b': 'Multilingual · Gemma 3 · 1B · Q8_0',
  'gemma3:4b': 'Multilingual · Gemma 3 · 4B · Q4_K_M',
};

export function parakeetDisplayName(model: string): string {
  return PARAKEET_NAMES[model] ?? `Language coverage unknown · ${model}`;
}

export function whisperDisplayName(model: string): string {
  if (WHISPER_NAMES[model]) return WHISPER_NAMES[model];
  const match = /^(tiny|base|small|medium|large-v3(?:-turbo)?)(?:-(q\d+_\d+))?$/.exec(model);
  if (!match) return `Language coverage unknown · Whisper ${model.replace(/[-_]+/g, ' ')}${/-q\d+_\d+$/.test(model) ? ' · compressed' : ''}`;
  const size = match[1].replace(/^./, letter => letter.toUpperCase()).replace('-v3', ' v3').replace('-turbo', ' Turbo');
  return `Multilingual · Whisper ${size} · ${match[2] ? `compressed ${match[2].toUpperCase()}` : 'standard'}`;
}

export function summaryDisplayName(model: string, fallback?: string): string {
  return SUMMARY_NAMES[model] ?? fallback ?? model;
}
