'use client';
import { LanguageChooser } from '@/components/tetro/LanguageChooser';
import React, { useState } from 'react';
import { canonicalModelName } from '@/lib/parakeet';
import { Globe } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';

import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';
import { LANGUAGES } from '@/constants/languages';
import { configService } from '@/services/configService';
import { WhisperAPI } from '@/lib/whisper';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import {
  applyTranscriptionLanguageSelection,
  ARMENIAN_WHISPER_MODEL,
  ARMENIAN_WHISPER_SIZE_MB,
  languagesForTranscriptionProvider,
  TranscriptConfig,
} from '@/lib/transcription-language-routing';

interface LanguageSelectionProps {
  selectedLanguage: string;
  disabled?: boolean;
  provider?: 'localWhisper' | 'parakeet' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai';
}

interface ModelDownloadProgress {
  modelName: string;
  progress: number;
}

export function LanguageSelection({
  selectedLanguage,
  disabled = false,
  provider = 'localWhisper',
}: LanguageSelectionProps) {
  const [saving, setSaving] = useState(false);
  const [pendingArmenianDownload, setPendingArmenianDownload] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const {
    transcriptModelConfig,
    setTranscriptModelConfig,
    setSelectedLanguage,
  } = useConfig();

  const isParakeet = provider === 'parakeet';
  const modelId = canonicalModelName(transcriptModelConfig.model);
  const displayedLanguage = isParakeet && modelId === 'stt-fastconformer-armenian' ? 'hy'
    : isParakeet && modelId === 'stt-parakeet-english' ? 'en' : selectedLanguage;
  const availableLanguages = languagesForTranscriptionProvider(LANGUAGES, provider);
  const controlsDisabled = disabled || saving || downloading;

  const applyLanguageSelection = async (languageCode: string) => {
    return applyTranscriptionLanguageSelection({
      languageCode,
      currentConfig: transcriptModelConfig,
      listWhisperModels: () => WhisperAPI.getAvailableModels(),
      saveTranscriptConfig: async (config: TranscriptConfig) => {
        const nextConfig = config as TranscriptModelProps;
        await configService.saveTranscriptConfig(nextConfig);
        setTranscriptModelConfig(nextConfig);
      },
      saveLanguage: setSelectedLanguage,
    });
  };

  const handleLanguageChange = async (languageCode: string) => {
    if (controlsDisabled) return;

    setSaving(true);
    setDownloadError(null);

    try {
      const result = await applyLanguageSelection(languageCode);
      if (result.status === 'download-required') {
        setPendingArmenianDownload(true);
        setDownloadProgress(0);
        return;
      }

      setPendingArmenianDownload(false);
    } catch (error) {
      console.error('Failed to save language preference:', error);
      toast.error('Failed to save language preference', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadArmenianModel = async () => {
    if (controlsDisabled) return;

    setDownloading(true);
    setDownloadProgress(0);
    setDownloadError(null);
    let unlistenProgress: (() => void) | undefined;

    try {
      unlistenProgress = await listen<ModelDownloadProgress>(
        'model-download-progress',
        (event) => {
          if (event.payload.modelName === ARMENIAN_WHISPER_MODEL) {
            setDownloadProgress(Math.round(event.payload.progress));
          }
        },
      );

      await WhisperAPI.init();
      await WhisperAPI.downloadModel(ARMENIAN_WHISPER_MODEL);

      const result = await applyLanguageSelection('hy');
      if (result.status !== 'applied') {
        throw new Error('Whisper large-v3 downloaded but is not available yet');
      }

      setPendingArmenianDownload(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to download the Armenian transcription model:', error);
      setDownloadError(message);
      toast.error('Whisper large-v3 download failed', {
        description: message,
      });
    } finally {
      unlistenProgress?.();
      setDownloading(false);
    }
  };

  const handleCancelArmenianDownload = () => {
    if (controlsDisabled) return;
    setPendingArmenianDownload(false);
    setDownloadProgress(0);
    setDownloadError(null);
  };

  const selectedLanguageName = LANGUAGES.find(
    (language) => language.code === displayedLanguage,
  )?.name || 'Auto Detect (Original Language)';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <LanguageChooser options={availableLanguages.map(l => ({ code: l.code, label: l.name }))} value={displayedLanguage} onChange={handleLanguageChange} disabled={controlsDisabled} />
        <p className="text-xs text-muted-foreground">This controls speech recognition. Summaries have their own language choice.</p>

        {pendingArmenianDownload && (
          <div className="space-y-3 rounded border border-blue-200 bg-blue-50 p-3 text-blue-900">
            <div>
              <p className="text-sm font-medium">Whisper large-v3 is required for Armenian</p>
              <p className="mt-1 text-xs">
                Download the {ARMENIAN_WHISPER_SIZE_MB.toLocaleString()} MB local model.
                Your current language and transcriber will stay unchanged until it is ready.
              </p>
            </div>

            {downloading && (
              <div className="space-y-1" aria-live="polite">
                <div className="h-2 overflow-hidden rounded bg-blue-100">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
                <p className="text-xs">Downloading: {downloadProgress}%</p>
              </div>
            )}

            {downloadError && (
              <p className="text-xs text-red-700 dark:text-red-300" role="alert">
                {downloadError}. Check your connection and retry.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelArmenianDownload}
                disabled={controlsDisabled}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDownloadArmenianModel}
                disabled={controlsDisabled}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {downloading ? 'Downloading…' : downloadError ? 'Retry download' : 'Download'}
              </button>
            </div>
          </div>
        )}

        {isParakeet && (
          <div className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">Automatic model switching</p>
            <p className="mt-1 text-xs">
              {modelId === 'stt-fastconformer-armenian' ? 'This model hears Armenian only. Choose English, Russian, or automatic detection above to switch models.'
                : modelId === 'stt-parakeet-english' ? 'This model hears English only. Choose automatic detection for more languages.'
                  : 'This model detects the spoken language automatically. Choose Armenian above to switch to an Armenian model.'}
            </p>
          </div>
        )}

        <div className="space-y-2 pt-2 text-xs">
          {displayedLanguage === 'auto' && (
            <div className="rounded border border-yellow-200 bg-yellow-50 p-2 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-100">
              <p>Auto-detect can guess wrong. Pick the language when you know it.</p>
            </div>
          )}
          {selectedLanguage === 'auto-translate' && (
            <div className="rounded border border-blue-200 bg-blue-50 p-2 text-blue-800">
              <p className="font-medium">Translation mode active</p>
              <p className="mt-1">Transcription will be translated to English.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
