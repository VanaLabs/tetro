export const ARMENIAN_WHISPER_MODEL = 'large-v3-turbo-hy';
// Armenian fine-tune of Whisper large-v3-turbo; also keeps English and Russian words.
export const ARMENIAN_WHISPER_SIZE_MB = 1549;
// Armenian-tuned Whisper models, best first. The first one that's installed is used.
export const ARMENIAN_WHISPER_MODELS = [ARMENIAN_WHISPER_MODEL];
export const isArmenianWhisperModel = (name: string) => ARMENIAN_WHISPER_MODELS.includes(name) || /-hy(-|$)/.test(name);
export const DEFAULT_PARAKEET_MODEL = 'stt-parakeet-multilingual';
export const ARMENIAN_PARAKEET_MODEL = 'stt-fastconformer-armenian';

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
      requiresWhisperModel: boolean;
    };

export interface TranscriptConfig {
  provider: string;
  model: string;
  apiKey?: string | null;
}

export interface WhisperModel {
  name: string;
  status: unknown;
}

export interface ApplyLanguageSelectionOptions {
  languageCode: string;
  currentConfig: TranscriptConfig;
  listWhisperModels: () => Promise<WhisperModel[]>;
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
    }
  | {
      status: 'download-required';
      model: typeof ARMENIAN_WHISPER_MODEL;
      sizeMb: typeof ARMENIAN_WHISPER_SIZE_MB;
    };

export function resolveTranscriptionRoute(languageCode: string): TranscriptionRoute {
  if (languageCode === 'hy') {
    return {
      kind: 'switch',
      provider: 'localWhisper',
      model: ARMENIAN_WHISPER_MODEL,
      requiresWhisperModel: true,
    };
  }

  if (languageCode === 'en' || languageCode === 'ru') {
    return {
      kind: 'switch',
      provider: 'parakeet',
      model: DEFAULT_PARAKEET_MODEL,
      requiresWhisperModel: false,
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
  listWhisperModels,
  saveTranscriptConfig,
  saveLanguage,
}: ApplyLanguageSelectionOptions): Promise<ApplyLanguageSelectionResult> {
  // Keep the NVIDIA Armenian model when it's already chosen instead of switching to Whisper.
  const route: TranscriptionRoute =
    languageCode === 'hy' && currentConfig.provider === 'parakeet' && currentConfig.model === ARMENIAN_PARAKEET_MODEL
      ? { kind: 'keep-current' }
      : languageCode === 'auto' && currentConfig.provider === 'parakeet'
        ? { kind: 'switch', provider: 'parakeet', model: DEFAULT_PARAKEET_MODEL, requiresWhisperModel: false }
        : resolveTranscriptionRoute(languageCode);
  let chosenModel: string | undefined;

  if (route.kind === 'keep-current') {
    await saveLanguage(languageCode);
    return { status: 'applied', config: currentConfig };
  }

  if (route.requiresWhisperModel) {
    const models = await listWhisperModels();
    const installed = new Set(models.filter((model) => model.status === 'Available').map((model) => model.name));
    const candidates = languageCode === 'hy' ? ARMENIAN_WHISPER_MODELS : [route.model];
    const model = candidates.find((name) => installed.has(name));

    chosenModel = model;
    if (!model) {
      return {
        status: 'download-required',
        model: ARMENIAN_WHISPER_MODEL,
        sizeMb: ARMENIAN_WHISPER_SIZE_MB,
      };
    }
  }

  const nextConfig: TranscriptConfig = {
    provider: route.provider,
    model: route.requiresWhisperModel ? chosenModel ?? route.model : route.model,
    apiKey: null,
  };

  await saveTranscriptConfig(nextConfig);

  try {
    await saveLanguage(languageCode);
  } catch (error) {
    await saveTranscriptConfig(currentConfig);
    throw error;
  }

  return { status: 'applied', config: nextConfig };
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
