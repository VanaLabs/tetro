export const ARMENIAN_WHISPER_MODEL = 'large-v3-turbo-hy';
// Armenian fine-tune of Whisper large-v3-turbo; also keeps English and Russian words.
// Armenian-tuned Whisper models, best first. The first one that's installed is used.
export const ARMENIAN_WHISPER_MODELS = [ARMENIAN_WHISPER_MODEL];
export const isArmenianWhisperModel = (name: string) => ARMENIAN_WHISPER_MODELS.includes(name) || /-hy(-|$)/.test(name);
export const DEFAULT_PARAKEET_MODEL = 'stt-parakeet-multilingual';
export const ARMENIAN_PARAKEET_MODEL = 'stt-fastconformer-armenian';
export const ARMENIAN_PARAKEET_SIZE_MB = 137;

// Multilingual Whisper models can also transcribe Armenian; English-only variants cannot.
export const whisperSupportsArmenian = (name: string) => isArmenianWhisperModel(name)
  || /^(tiny|base|small|medium|large-v[123])(?:-turbo)?(?:-q\d_\d)?$/.test(name);

const PARAKEET_VISIBLE_LANGUAGE_CODES = new Set([
  'auto',
  'auto-translate',
  'en',
  'ru',
  'hy',
]);

export type TranscriptionRoute =
  | { kind: 'keep-current' }
  | {
      kind: 'switch';
      provider: 'localWhisper' | 'parakeet';
      model: string;
      requiresParakeetModel: boolean;
    };

export interface TranscriptConfig {
  provider: string;
  model: string;
  apiKey?: string | null;
}

export interface TranscriptionModel {
  name: string;
  status: unknown;
}

export interface ApplyLanguageSelectionOptions {
  languageCode: string;
  currentConfig: TranscriptConfig;
  listParakeetModels: () => Promise<TranscriptionModel[]>;
  listWhisperModels: () => Promise<TranscriptionModel[]>;
  useRecommendedArmenianModel?: boolean;
  saveTranscriptConfig: (config: TranscriptConfig) => Promise<void>;
  saveLanguage: (languageCode: string) => Promise<void>;
}

export interface LanguagePreferencePersistence {
  readStoredLanguage: () => string | null;
  writeStoredLanguage: (languageCode: string | null) => void;
  syncLanguage: (languageCode: string) => Promise<void>;
}

export type ApplyLanguageSelectionResult =
  | {
      status: 'applied';
      config: TranscriptConfig;
      armenianRecommendation?: { available: boolean };
    }
  | {
      status: 'download-required';
      model: typeof ARMENIAN_PARAKEET_MODEL;
      sizeMb: typeof ARMENIAN_PARAKEET_SIZE_MB;
    };

export function resolveTranscriptionRoute(languageCode: string): TranscriptionRoute {
  if (languageCode === 'hy') {
    return {
      kind: 'switch',
      provider: 'parakeet',
      model: ARMENIAN_PARAKEET_MODEL,
      requiresParakeetModel: true,
    };
  }

  if (languageCode === 'en' || languageCode === 'ru') {
    return {
      kind: 'switch',
      provider: 'parakeet',
      model: DEFAULT_PARAKEET_MODEL,
      requiresParakeetModel: false,
    };
  }

  return { kind: 'keep-current' };
}

export function languagesForTranscriptionProvider<T extends { code: string }>(
  languages: readonly T[],
  provider: string,
): T[] {
  if (provider !== 'parakeet') {
    return [...languages];
  }

  return languages.filter((language) => PARAKEET_VISIBLE_LANGUAGE_CODES.has(language.code));
}

export function isPrimaryLanguageSelectionAvailable(provider: string): boolean {
  return provider === 'localWhisper' || provider === 'parakeet';
}

export async function applyTranscriptionLanguageSelection({
  languageCode,
  currentConfig,
  listParakeetModels,
  listWhisperModels,
  useRecommendedArmenianModel = false,
  saveTranscriptConfig,
  saveLanguage,
}: ApplyLanguageSelectionOptions): Promise<ApplyLanguageSelectionResult> {
  let route: TranscriptionRoute = languageCode === 'auto' && currentConfig.provider === 'parakeet'
    ? { kind: 'switch', provider: 'parakeet', model: DEFAULT_PARAKEET_MODEL, requiresParakeetModel: false }
    : resolveTranscriptionRoute(languageCode);
  let armenianRecommendation: { available: boolean } | undefined;

  if (route.kind === 'switch' && route.requiresParakeetModel) {
    const [parakeet, whisper] = await Promise.all([listParakeetModels(), listWhisperModels()]);
    const nvidiaAvailable = parakeet.some(model => model.name === ARMENIAN_PARAKEET_MODEL && model.status === 'Available');
    const compatibleWhisper = whisper.filter(model => model.status === 'Available' && whisperSupportsArmenian(model.name));
    const currentWhisper = currentConfig.provider === 'localWhisper'
      ? compatibleWhisper.find(model => model.name === currentConfig.model) : undefined;
    const fallback = currentWhisper
      ?? compatibleWhisper.find(model => isArmenianWhisperModel(model.name))
      ?? compatibleWhisper.find(model => model.name.startsWith('large-'))
      ?? compatibleWhisper[0];

    if (!useRecommendedArmenianModel && fallback && (currentWhisper || !nvidiaAvailable)) {
      route = currentWhisper ? { kind: 'keep-current' }
        : { kind: 'switch', provider: 'localWhisper', model: fallback.name, requiresParakeetModel: false };
      armenianRecommendation = { available: nvidiaAvailable };
    } else if (!nvidiaAvailable) {
      return { status: 'download-required', model: ARMENIAN_PARAKEET_MODEL, sizeMb: ARMENIAN_PARAKEET_SIZE_MB };
    }
  }

  if (route.kind === 'keep-current') {
    await saveLanguage(languageCode);
    return { status: 'applied', config: currentConfig, armenianRecommendation };
  }

  const nextConfig: TranscriptConfig = {
    provider: route.provider,
    model: route.model,
    apiKey: null,
  };

  await saveTranscriptConfig(nextConfig);

  try {
    await saveLanguage(languageCode);
  } catch (error) {
    await saveTranscriptConfig(currentConfig);
    throw error;
  }

  return { status: 'applied', config: nextConfig, armenianRecommendation };
}

export async function persistLanguagePreference(
  languageCode: string,
  persistence: LanguagePreferencePersistence,
): Promise<void> {
  const previousLanguage = persistence.readStoredLanguage();
  persistence.writeStoredLanguage(languageCode);

  try {
    await persistence.syncLanguage(languageCode);
  } catch (error) {
    persistence.writeStoredLanguage(previousLanguage);
    throw error;
  }
}
