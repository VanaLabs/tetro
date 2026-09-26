'use client';
import { subscribeModelCatalog, publishModelCatalog } from '@/lib/model-catalog-read';
import { modelUseNote } from '@/lib/model-removal';
import { activateModel, requestModelActivation, cancelModelActivation } from '@/lib/model-activation';
import { useConfirm } from '@/components/tetro/useConfirm';
import { ModelSpecs, ReelGlyph } from '@/components/tetro/ModelGlyphs';
import { ModelRow, rowStateFromStatus } from '@/components/tetro/ModelRow';
import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  ModelInfo,
  ModelStatus,
  formatFileSize,
  getModelTagline,
  getWhisperDisplayName,
  WhisperAPI
} from '../lib/whisper';

interface ModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
  /** 'rows': compact one-line list for managing downloads (Settings → Models). */
  variant?: 'cards' | 'rows';
  /** Rows only: every size instead of the recommended ones plus downloads. */
  showAll?: boolean;
  scope?: 'recommended' | 'installed' | 'more';
  recommendedId?: string;
  filterModel?: (modelId: string) => boolean;
}

export function ModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false,
  variant = 'cards',
  showAll = false,
  scope, recommendedId = 'small', filterModel
}: ModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => subscribeModelCatalog<ModelInfo[]>('whisper_get_available_models', setModels), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());
  const [cancellingModels, setCancellingModels] = useState<Set<string>>(new Set());
  const [hasUserSelection, setHasUserSelection] = useState(false);

  // Refs for stable callbacks
  const onModelSelectRef = useRef(onModelSelect);
  const autoSaveRef = useRef(autoSave);
  const requestedHere = useRef(new Set<string>());

  // Progress throttle map to prevent rapid updates
  const progressThrottleRef = useRef<Map<string, { progress: number; timestamp: number }>>(new Map());
  const cancellationReconciliationModelsRef = useRef<Set<string>>(new Set());
  const cancellationReconcileTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Update refs when props change
  useEffect(() => {
    onModelSelectRef.current = onModelSelect;
    autoSaveRef.current = autoSave;
  }, [onModelSelect, autoSave]);

  // Load persisted downloading state from localStorage
  const getPersistedDownloadingModels = (): Set<string> => {
    try {
      const saved = localStorage.getItem('downloading-models');
      return saved ? new Set<string>(JSON.parse(saved) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  };

  // Persist downloading state to localStorage
  const updateDownloadingModels = (updater: (prev: Set<string>) => Set<string>) => {
    setDownloadingModels(prev => {
      const newSet = updater(prev);
      localStorage.setItem('downloading-models', JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  };

  const clearCancellationReconciliation = (modelName: string) => {
    cancellationReconciliationModelsRef.current.delete(modelName);
    const timer = cancellationReconcileTimersRef.current.get(modelName);
    if (timer !== undefined) {
      clearTimeout(timer);
      cancellationReconcileTimersRef.current.delete(modelName);
    }
    setCancellingModels(prev => {
      const next = new Set(prev);
      next.delete(modelName);
      return next;
    });
  };

  const reconcileCancellation = (modelName: string) => {
    if (cancellationReconciliationModelsRef.current.has(modelName)) return;

    cancellationReconciliationModelsRef.current.add(modelName);
    setCancellingModels(prev => new Set([...prev, modelName]));

    const scheduleNextCheck = () => {
      if (!cancellationReconciliationModelsRef.current.has(modelName)) return;
      const timer = setTimeout(() => {
        cancellationReconcileTimersRef.current.delete(modelName);
        void reconcile();
      }, 1000);
      cancellationReconcileTimersRef.current.set(modelName, timer);
    };

    const reconcile = async () => {
      try {
        const modelList = await WhisperAPI.getAvailableModels();
        if (!cancellationReconciliationModelsRef.current.has(modelName)) return;

        const model = modelList.find(candidate => candidate.name === modelName);

        const isStillDownloading = typeof model?.status === 'object' && 'Downloading' in model.status;
        if (model && !isStillDownloading) {
          clearCancellationReconciliation(modelName);
          updateDownloadingModels(prev => {
            const next = new Set(prev);
            next.delete(modelName);
            return next;
          });
          setModels(modelList);
          progressThrottleRef.current.delete(modelName);
          toast.info(
            model.status === 'Available'
              ? `${getDisplayName(modelName)} download completed before cancellation`
              : `${getDisplayName(modelName)} download cancelled`,
            { duration: 3000 }
          );
          return;
        }
      } catch (err) {
        console.warn('Failed to reconcile pending download cancellation:', err);
      }

      scheduleNextCheck();
    };

    void reconcile();
  };

  // Initialize models
  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await WhisperAPI.init();
        const modelList = await WhisperAPI.getAvailableModels();

        // Apply persisted downloading states
        const persistedDownloading = getPersistedDownloadingModels();
        const modelsWithDownloadState = modelList.map(model => {
          if (persistedDownloading.has(model.name) && model.status !== 'Available') {
            if (typeof model.status === 'object' && 'Corrupted' in model.status) {
              updateDownloadingModels(prev => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else if (model.status === 'Missing') {
              updateDownloadingModels(prev => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else {
              return { ...model, status: { Downloading: { progress: 0 } } as ModelStatus };
            }
          }
          return model;
        });

        setModels(modelsWithDownloadState);
        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Whisper:', err);
        setError(err instanceof Error ? err.message : 'Failed to load models');
        toast.error('Failed to load transcription models', {
          description: err instanceof Error ? err.message : 'Unknown error',
          duration: 5000
        });
      } finally {
        setLoading(false);
      }
    };

    initializeModels();
  }, [initialized, selectedModel, onModelSelect]);

  // Set up event listeners for download progress
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupListeners = async () => {
      console.log('[ModelManager] Setting up event listeners...');

      // Download progress with throttling
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        'model-download-progress',
        (event) => {
          const { modelName, progress } = event.payload;
          const now = Date.now();
          const throttleData = progressThrottleRef.current.get(modelName);

          // Throttle: only update if 300ms passed OR progress jumped by 5%+
          const shouldUpdate = !throttleData ||
            now - throttleData.timestamp > 300 ||
            Math.abs(progress - throttleData.progress) >= 5;

          if (shouldUpdate) {
            console.log(`[ModelManager] Progress update for ${modelName}: ${progress}%`);
            progressThrottleRef.current.set(modelName, { progress, timestamp: now });

            setModels(prevModels =>
              prevModels.map(model =>
                model.name === modelName
                  ? { ...model, status: { Downloading: { progress } } as ModelStatus }
                  : model
              )
            );
          }
        }
      );

      // Download complete
      unlistenComplete = await listen<{ modelName: string }>(
        'model-download-complete',
        (event) => {
          const { modelName } = event.payload;
          const model = models.find(m => m.name === modelName);
          const displayName = getDisplayName(modelName);

          clearCancellationReconciliation(modelName);

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: 'Available' as ModelStatus }
                : model
            )
          );

          updateDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.success(`${displayName} ready`, {
            description: 'Model downloaded and ready to use',
            duration: 4000
          });

          // Only a download initiated here may update this chooser.
          if (requestedHere.current.delete(modelName) && onModelSelectRef.current) {
            void (async () => {
              try {
                if (autoSaveRef.current) await saveModelSelection(modelName);
                onModelSelectRef.current?.(modelName);
              } catch (error) { toast.error('Downloaded, but couldn’t switch models', { description: String(error) }); }
            })();
          }
        }
      );

      // Download error
      unlistenError = await listen<{ modelName: string; error: string }>(
        'model-download-error',
        (event) => {
          const { modelName, error } = event.payload;
          const displayName = getDisplayName(modelName);

          clearCancellationReconciliation(modelName);

          setModels(prevModels =>
            prevModels.map(model =>
              model.name === modelName
                ? { ...model, status: { Error: error } as ModelStatus }
                : model
            )
          );

          updateDownloadingModels(prev => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.error(`Failed to download ${displayName}`, {
            description: error,
            duration: 6000,
            action: {
              label: 'Retry',
              onClick: () => downloadModel(modelName)
            }
          });
        }
      );
    };

    setupListeners();

    return () => {
      console.log('[ModelManager] Cleaning up event listeners...');
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
      for (const timer of cancellationReconcileTimersRef.current.values()) {
        clearTimeout(timer);
      }
      cancellationReconcileTimersRef.current.clear();
      cancellationReconciliationModelsRef.current.clear();
    };
  }, []); // Empty dependency array - listeners use refs for stable callbacks

  const saveModelSelection = async (modelName: string) => {
    try {
      await invoke('api_save_transcript_config', {
        provider: 'localWhisper',
        model: modelName,
        apiKey: null
      });
    } catch (error) {
      throw error;
    }
  };

  const cancelDownload = async (modelName: string) => {
    requestedHere.current.delete(modelName);
    const displayName = getDisplayName(modelName);

    try {
      const outcome = await WhisperAPI.cancelDownload(modelName);
      if (outcome === 'pending') {
        reconcileCancellation(modelName);
        toast.info(`Cancelling ${displayName}...`, {
          description: 'The download is still shutting down. Retry will be available when cleanup completes.',
          duration: 4000
        });
        return;
      }

      // A worker can finish between the user's click and the cancellation command
      // acquiring its owner. Reconcile instead of overwriting a valid Available state.
      reconcileCancellation(modelName);
    } catch (err) {
      console.error('Failed to cancel download:', err);
      toast.error('Failed to cancel download', {
        description: err instanceof Error ? err.message : 'Unknown error',
        duration: 4000
      });
    }
  };

  const downloadModel = async (modelName: string) => {
    if (variant !== 'rows') requestedHere.current.add(modelName);
    if (downloadingModels.has(modelName)) return;

    clearCancellationReconciliation(modelName);

    const displayName = getDisplayName(modelName);

    try {
      updateDownloadingModels(prev => new Set([...prev, modelName]));

      setModels(prevModels =>
        prevModels.map(model =>
          model.name === modelName
            ? { ...model, status: { Downloading: { progress: 0 } } as ModelStatus }
            : model
        )
      );

      toast.info(`Downloading ${displayName}...`, {
        description: 'This may take a few minutes',
        duration: 5000
      });

      await WhisperAPI.downloadModel(modelName);
    } catch (err) {
      console.error('Download failed:', err);
      updateDownloadingModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      setModels(prev =>
        prev.map(model =>
          model.name === modelName ? { ...model, status: { Error: errorMessage } } : model
        )
      );
    }
  };

  const selectModel = async (modelName: string) => {
    try {
      if (autoSave) await saveModelSelection(modelName);
      onModelSelect?.(modelName);
      toast.success(`Switched to ${getDisplayName(modelName)}`, { duration: 2000 });
    } catch (error) { toast.error('Couldn’t switch models', { description: String(error) }); }
  };

  const { confirm, dialog: confirmDialog } = useConfirm();
  const [modelFilter, setModelFilter] = useState<'recommended' | 'small-size' | 'small' | 'medium' | 'large' | 'downloaded'>('recommended');
  const deleteModel = async (modelName: string) => {
    const info = models.find(m => m.name === modelName);
    const ok = await confirm({
      title: `Remove ${getDisplayName(modelName)}?`,
      body: <>{info?.size_mb ? `This frees ${formatFileSize(info.size_mb)}. ` : ''}You can download it again. {modelUseNote('localWhisper', modelName, selectedModel === modelName)}</>,
      confirm: 'Delete',
    });
    if (!ok) return;
    const displayName = getDisplayName(modelName);

    try {
      await WhisperAPI.deleteCorruptedModel(modelName);

      // Refresh models list
      const modelList = await WhisperAPI.getAvailableModels();
      publishModelCatalog('whisper_get_available_models', modelList);

      toast.success(`${displayName} deleted`, {
        description: 'Model removed to free up space',
        duration: 3000
      });

    } catch (err) {
      console.error('Failed to delete model:', err);
      toast.error(`Failed to delete ${displayName}`, {
        description: err instanceof Error ? err.message : 'Delete failed',
        duration: 4000
      });
    }
  };

  const getDisplayName = getWhisperDisplayName;

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
      {confirmDialog}
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-gray-100 rounded-lg"></div>
          <div className="h-20 bg-gray-100 rounded-lg"></div>
          <div className="h-20 bg-gray-100 rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
        <p className="text-sm text-red-800">Failed to load models</p>
        <p className="text-xs text-red-600 mt-1">{error}</p>
      </div>
    );
  }

  // Size filter. "Recommended" is a short list of good picks plus anything already downloaded.
  const RECOMMENDED = ['tiny', 'small', 'large-v3-turbo-q5_0', 'large-v3-turbo', 'large-v3-turbo-hy'];
  const BEST = 'large-v3-turbo-q5_0';
  const sizeOf = (name: string) => name.startsWith('tiny') || name.startsWith('base') ? 'small-size' : name.startsWith('small') ? 'small' : name.startsWith('medium') ? 'medium' : 'large';
  const shown = variant === 'rows'
    ? models.filter(m => (scope === 'recommended' ? m.name === recommendedId : scope === 'installed' ? m.status === 'Available' : scope === 'more' ? m.status !== 'Available' : showAll || RECOMMENDED.includes(m.name) || m.status === 'Available' || downloadingModels.has(m.name)) && (!filterModel || filterModel(m.name))).sort((a, b) => a.size_mb - b.size_mb)
    : models
    .filter(m => modelFilter === 'recommended' ? RECOMMENDED.includes(m.name) || m.status === 'Available'
      : modelFilter === 'downloaded' ? m.status === 'Available'
      : sizeOf(m.name) === modelFilter)
    .sort((a, b) => a.size_mb - b.size_mb);
  const counts = { downloaded: models.filter(m => m.status === 'Available').length };

  return (
    <div className={`space-y-3 ${className}`}>
      {confirmDialog}
      {variant === 'cards' && <div className="tetro-model-filter" role="radiogroup" aria-label="Show models">
        {([['recommended', 'Recommended'], ['small-size', 'Tiny & Base'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['downloaded', `Downloaded · ${counts.downloaded}`]] as const).map(([value, label]) =>
          <button key={value} type="button" role="radio" aria-checked={modelFilter === value} onClick={() => setModelFilter(value)}>{label}</button>)}
      </div>}
      {variant === 'rows' ? <div className="tetro-model-rows">
        {shown.map(model => {
          const state = rowStateFromStatus(model.status, cancellingModels.has(model.name));
          return (
            <ModelRow key={model.name} name={getDisplayName(model.name)} note={`Transcription · ${getModelTagline(model.name, model.speed, model.accuracy)}`}
              badge={model.name === recommendedId ? <span className="tetro-recommended">Recommended</span> : undefined}
              sizeMb={model.size_mb} sizeLabel={formatFileSize(model.size_mb)} speed={model.speed} accuracy={model.accuracy}
              inUse={selectedModel === model.name}
              state={state.kind === 'missing' && downloadingModels.has(model.name) ? { kind: 'downloading', progress: 0 } : state}
              onUse={() => { void activateModel('localWhisper', model.name).catch(e => toast.error('Couldn’t switch models', { description: String(e) })); }}
              onDownload={() => { requestModelActivation('localWhisper', model.name); void downloadModel(model.name); }} onCancel={() => { cancelModelActivation('localWhisper', model.name); void cancelDownload(model.name); }} onDelete={() => deleteModel(model.name)} />
          );
        })}
      </div> : <div className="space-y-3">
        {shown.map(model => (
          <ModelCard
            key={model.name}
            model={model}
            isSelected={selectedModel === model.name}
            isRecommended={model.name === BEST}
            onSelect={() => { if (model.status === 'Available') selectModel(model.name); }}
            onDownload={() => downloadModel(model.name)}
            onCancel={() => cancelDownload(model.name)}
            onDelete={() => deleteModel(model.name)}
            isDownloading={downloadingModels.has(model.name)}
            isCancelling={cancellingModels.has(model.name)}
            displayName={getDisplayName(model.name)}
          />
        ))}
        {!shown.length && <p className="tetro-setting-note">{modelFilter === 'downloaded' ? 'No models downloaded yet.' : 'No models in this size.'}</p>}
      </div>}

      {/* Helper text */}
      {variant === 'cards' && selectedModel && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="tetro-in-use"
        >
          In use: <b>{getDisplayName(selectedModel)}</b>
        </motion.div>
      )}
    </div>
  );
}

// Model Card Component
interface ModelCardProps {
  model: ModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isDownloading: boolean;
  isCancelling: boolean;
  displayName: string;
}

function ModelCard({
  model,
  isSelected,
  isRecommended,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  isDownloading,
  isCancelling,
  displayName
}: ModelCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const isAvailable = model.status === 'Available';
  const isMissing = model.status === 'Missing';
  const isError = typeof model.status === 'object' && 'Error' in model.status;
  const isCorrupted = typeof model.status === 'object' && 'Corrupted' in model.status;
  const downloadProgress =
    typeof model.status === 'object' && 'Downloading' in model.status
      ? model.status.Downloading.progress
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        relative rounded-lg border-2 transition-all cursor-pointer
        ${isSelected && isAvailable
          ? 'border-blue-500 bg-blue-50'
          : isAvailable
            ? 'border-gray-200 hover:border-gray-300 bg-white'
            : 'border-gray-200 bg-gray-50'
        }
        ${isAvailable ? '' : 'cursor-default'}
      `}
      onClick={() => {
        if (isAvailable) onSelect();
      }}
    >

      <div className="p-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            {/* Model Name and Tagline */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <ReelGlyph sizeMb={model.size_mb} active={isSelected && isAvailable} />
              <h3 className="font-semibold text-gray-900">{displayName}</h3>
              {isRecommended && <span className="tetro-recommended">Best balance</span>}
              {!isRecommended && <span className="text-sm text-gray-500">• {getModelTagline(model.name, model.speed, model.accuracy)}</span>}
              {isSelected && isAvailable && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="bg-blue-600 text-white px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1"
                >
                  ✓
                </motion.span>
              )}
            </div>

            {/* Model Specs */}
            <div className="ml-10 mt-1.5">
              {isRecommended && <p className="text-sm text-gray-500 mb-2">{getModelTagline(model.name, model.speed, model.accuracy)}</p>}
              <ModelSpecs sizeLabel={formatFileSize(model.size_mb)} speed={model.speed} accuracy={model.accuracy} />
            </div>
          </div>

          {/* Status/Action */}
          <div className="ml-4 flex items-center gap-2">
            {isAvailable && (
              <>
                <div className="flex items-center gap-1.5 text-green-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-xs font-medium">Ready</span>
                </div>
                <AnimatePresence>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="tetro-model-remove"
                    title="Remove this model from the computer"
                    aria-label="Remove model"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                  </button>
                </AnimatePresence>
              </>
            )}

            {isMissing && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Download
              </button>
            )}

            {downloadProgress === null && isError && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className="bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Retry
              </button>
            )}

            {isCorrupted && (
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="bg-orange-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-orange-700 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload();
                  }}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Re-download
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Full-width Download Progress Bar - PROMINENT */}
        {downloadProgress !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 pt-3 border-t border-gray-200"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-blue-600">
                  {isCancelling ? 'Cancelling…' : 'Downloading...'}
                </span>
                {!isCancelling && (
                  <span className="text-sm font-semibold text-blue-600">{Math.round(downloadProgress)}%</span>
                )}
              </div>
              {isCancelling ? (
                <span className="text-xs text-gray-500 font-medium px-2 py-1">
                  Cancellation requested
                </span>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel();
                  }}
                  className="text-xs text-gray-600 hover:text-red-600 font-medium transition-colors px-2 py-1 rounded hover:bg-red-50"
                  title="Cancel download"
                >
                  Cancel
                </button>
              )}
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${downloadProgress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {model.size_mb ? (
                <>
                  {formatFileSize(model.size_mb * downloadProgress / 100)} / {formatFileSize(model.size_mb)}
                </>
              ) : (
                'Downloading...'
              )}
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
