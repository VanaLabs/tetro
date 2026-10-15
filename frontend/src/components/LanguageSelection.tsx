'use client';
import { LanguageChooser } from '@/components/tetro/LanguageChooser';
import React, { useState } from 'react';
import { ParakeetAPI } from '@/lib/parakeet';
import { recordingLanguageCode } from '@/lib/recording-setup';
import { listen } from '@tauri-apps/api/event';

import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';
import { LANGUAGES } from '@/constants/languages';
import { configService } from '@/services/configService';
import { WhisperAPI } from '@/lib/whisper';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import {
  applyTranscriptionLanguageSelection,
  ARMENIAN_PARAKEET_MODEL,
  ARMENIAN_PARAKEET_SIZE_MB,
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
  const [pendingArmenianDownload, setPendingArmenianDownload] = useState<{ optional: boolean; available: boolean } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const {
    transcriptModelConfig,
    setTranscriptModelConfig,
    setSelectedLanguage,
  } = useConfig();

  const displayedLanguage = recordingLanguageCode(provider, transcriptModelConfig.model, selectedLanguage);
  const availableLanguages = languagesForTranscriptionProvider(LANGUAGES, provider);
  const controlsDisabled = disabled || saving || downloading;

  const applyLanguageSelection = async (languageCode: string, useRecommendedArmenianModel = false) => {
    return applyTranscriptionLanguageSelection({
      languageCode,
      currentConfig: transcriptModelConfig,
      listParakeetModels: () => ParakeetAPI.getAvailableModels(),
      listWhisperModels: () => WhisperAPI.getAvailableModels(),
      useRecommendedArmenianModel,
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
        setPendingArmenianDownload({ optional: false, available: false });
        setDownloadProgress(0);
        return;
      }

      setPendingArmenianDownload(result.armenianRecommendation
        ? { optional: true, available: result.armenianRecommendation.available } : null);
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
      if (!pendingArmenianDownload?.available) {
        unlistenProgress = await listen<ModelDownloadProgress>(
          'parakeet-model-download-progress',
          (event) => {
            if (event.payload.modelName === ARMENIAN_PARAKEET_MODEL) {
              setDownloadProgress(Math.round(event.payload.progress));
            }
          },
        );

        await ParakeetAPI.init();
        await ParakeetAPI.downloadModel(ARMENIAN_PARAKEET_MODEL);
      }

      const result = await applyLanguageSelection('hy', true);
      if (result.status !== 'applied') {
        throw new Error('Armenian NVIDIA FastConformer downloaded but is not available yet');
      }

      setPendingArmenianDownload(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to download the Armenian transcription model:', error);
      setDownloadError(message);
      toast.error('Armenian model download failed', {
        description: message,
      });
    } finally {
      unlistenProgress?.();
      setDownloading(false);
    }
  };

  const handleCancelArmenianDownload = () => {
    if (controlsDisabled) return;
    setPendingArmenianDownload(null);
    setDownloadProgress(0);
    setDownloadError(null);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <LanguageChooser options={availableLanguages.map(l => ({ code: l.code, label: l.name }))} value={displayedLanguage} onChange={handleLanguageChange} disabled={controlsDisabled} />
        <p className="text-xs text-muted-foreground">This controls speech recognition. Summaries have their own language choice.</p>

        {pendingArmenianDownload && (
          <div className={`space-y-3 rounded border p-3 ${pendingArmenianDownload.optional
            ? 'border-border bg-muted/30 text-foreground'
            : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
            <div>
              <p className="text-sm font-medium">{pendingArmenianDownload.optional ? 'Recommended for Armenian' : 'Download an Armenian model'}</p>
              <p className="mt-1 text-xs">
                Armenian · NVIDIA FastConformer · INT8 is a {ARMENIAN_PARAKEET_SIZE_MB.toLocaleString()} MB local model.{' '}
                {pendingArmenianDownload.optional
                  ? 'Optional — you can keep using your current Whisper model.'
                  : 'Your current language and model will stay unchanged until it is ready.'}
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
                {pendingArmenianDownload.optional ? 'Keep current model' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleDownloadArmenianModel}
                disabled={controlsDisabled}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {downloading ? 'Preparing…' : pendingArmenianDownload.available ? 'Use NVIDIA model' : downloadError ? 'Retry download' : 'Download'}
              </button>
            </div>
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
