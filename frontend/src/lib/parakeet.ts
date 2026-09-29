import { readModelCatalog } from './model-catalog-read';
import { parakeetDisplayName } from './model-display';
// Types for Parakeet (NVIDIA NeMo) integration
export interface ParakeetModelInfo {
  name: string;
  path: string;
  size_mb: number;
  accuracy: ModelAccuracy;
  speed: ProcessingSpeed;
  status: ModelStatus;
  description?: string;
  quantization: QuantizationType;
}

export type QuantizationType = 'FP32' | 'Int8';
export type ModelAccuracy = 'High' | 'Good' | 'Decent';
export type ProcessingSpeed = 'Slow' | 'Medium' | 'Fast' | 'Very Fast' | 'Ultra Fast';

export type ModelStatus =
  | 'Available'
  | 'Missing'
  | { Paused: { downloaded_bytes: number } }
  | { Downloading: { progress: number } }
  | { Error: string }
  | { Corrupted: { file_size: number; expected_min_size: number } };

export type CancelDownloadOutcome = 'cancelled' | 'pending';
export type ParakeetDownloadEventStatus = 'downloading' | 'completed' | 'cancelled';

export interface ParakeetDownloadProgressEvent {
  modelName: string;
  progress: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  downloaded_mb?: number;
  total_mb?: number;
  speed_mbps?: number;
  status: ParakeetDownloadEventStatus;
}

export interface ParakeetEngineState {
  currentModel: string | null;
  availableModels: ParakeetModelInfo[];
  isLoading: boolean;
  error: string | null;
}

// User-friendly model display configuration
export interface ModelDisplayInfo {
  friendlyName: string;
  tagline: string;
  /** Plain-language coverage, e.g. "25 languages" or "English" */
  languages: string;
  recommended?: boolean;
  tier: 'fastest' | 'balanced' | 'precise';
}

export const MODEL_DISPLAY_CONFIG: Record<string, ModelDisplayInfo> = {
  'stt-parakeet-multilingual': {
    friendlyName: parakeetDisplayName('stt-parakeet-multilingual'),
    tagline: 'Real time. English, Russian and 23 more languages.',
    languages: '25 languages',
    recommended: true,
    tier: 'fastest'
  },
  'stt-parakeet-english': {
    friendlyName: parakeetDisplayName('stt-parakeet-english'),
    tagline: 'Real time. English only.',
    languages: 'English',
    tier: 'balanced'
  },
  'stt-fastconformer-armenian': {
    friendlyName: parakeetDisplayName('stt-fastconformer-armenian'),
    tagline: 'Real time. Armenian only, with punctuation.',
    languages: 'Armenian',
    tier: 'balanced'
  }
};

// Real-time speech models (matching the Rust catalog). IDs match the Vana Labs Hugging Face repos:
// huggingface.co/Vana-Labs/<id>
export const PARAKEET_MODEL_CONFIGS: Record<string, Partial<ParakeetModelInfo>> = {
  'stt-parakeet-multilingual': {
    description: 'Real time on M4 Max, optimized for speed',
    size_mb: 670, // Actual download: 652MB encoder + 18.2MB decoder + 0.2MB extras
    accuracy: 'High',
    speed: 'Ultra Fast',
    quantization: 'Int8'
  },
  'stt-parakeet-english': {
    description: '25x real-time, smaller size with good accuracy',
    size_mb: 661, // Actual download: 652MB encoder + 9MB decoder + 0.15MB extras
    accuracy: 'High',
    speed: 'Very Fast',
    quantization: 'Int8'
  },
  'stt-fastconformer-armenian': {
    description: 'NVIDIA FastConformer for Armenian',
    size_mb: 137,
    accuracy: 'High',
    speed: 'Fast',
    quantization: 'Int8'
  }
};

// Helper functions
// Get user-friendly display name for a model
export function getModelDisplayName(modelName: string): string {
  const displayInfo = MODEL_DISPLAY_CONFIG[canonicalModelName(modelName)];
  return displayInfo?.friendlyName || modelName;
}

/** IDs before 2026-09-24, e.g. on older meetings. Current IDs match the Vana Labs repo names. */
const LEGACY_MODEL_NAMES: Record<string, string> = {
  'parakeet-tdt-0.6b-v3-int8': 'stt-parakeet-multilingual',
  'parakeet-tdt-0.6b-v2-int8': 'stt-parakeet-english',
  'armenian-fastconformer-hy-int8': 'stt-fastconformer-armenian',
  'multilingual-speech-to-text': 'stt-parakeet-multilingual',
  'english-speech-to-text': 'stt-parakeet-english',
  'armenian-speech-to-text': 'stt-fastconformer-armenian',
};
export const canonicalModelName = (modelName: string) => LEGACY_MODEL_NAMES[modelName] ?? modelName;

// Get model display info (icon, tagline, etc.)
export function getModelDisplayInfo(modelName: string): ModelDisplayInfo | null {
  modelName = canonicalModelName(modelName);
  return MODEL_DISPLAY_CONFIG[modelName] || null;
}

export function getStatusColor(status: ModelStatus): string {
  if (status === 'Available') return 'green';
  if (status === 'Missing') return 'gray';
  if (typeof status === 'object' && 'Downloading' in status) return 'blue';
  if (typeof status === 'object' && 'Error' in status) return 'red';
  return 'gray';
}

export function formatFileSize(sizeMb: number): string {
  if (sizeMb >= 1000) {
    return `${(sizeMb / 1000).toFixed(1)}GB`;
  }
  return `${sizeMb}MB`;
}

// Helper function to check if model is quantized
export function isQuantizedModel(modelName: string): boolean {
  return modelName.includes('int8');
}

// Helper function to get model performance badge
export function getModelPerformanceBadge(quantization: QuantizationType): { label: string; color: string } {
  switch (quantization) {
    case 'FP32':
      return { label: 'Full Precision', color: 'blue' };
    case 'Int8':
      return { label: 'Int8 Quantized', color: 'green' };
    default:
      return { label: 'Standard', color: 'gray' };
  }
}

export function getRecommendedModel(systemSpecs?: { ram: number; cores: number }): string {
  // Default to Int8 quantized model (fastest)
  if (!systemSpecs) return 'stt-parakeet-multilingual';

  // For any system, prefer Int8 for speed
  // FP32 can be used if user explicitly wants higher precision
  return 'stt-parakeet-multilingual';
}

// Tauri command wrappers for Parakeet backend
import { invoke } from '@tauri-apps/api/core';

export class ParakeetAPI {
  static async init(): Promise<void> {
    await invoke('parakeet_init');
  }

  static async getAvailableModels(): Promise<ParakeetModelInfo[]> {
    return await readModelCatalog('parakeet_get_available_models');
  }

  static async loadModel(modelName: string): Promise<void> {
    await invoke('parakeet_load_model', { modelName });
  }

  static async getCurrentModel(): Promise<string | null> {
    return await invoke('parakeet_get_current_model');
  }

  static async isModelLoaded(): Promise<boolean> {
    return await invoke('parakeet_is_model_loaded');
  }

  static async transcribeAudio(audioData: number[]): Promise<string> {
    return await invoke('parakeet_transcribe_audio', { audioData });
  }

  static async getModelsDirectory(): Promise<string> {
    return await invoke('parakeet_get_models_directory');
  }

  static async downloadModel(modelName: string): Promise<void> {
    await invoke('parakeet_download_model', { modelName });
  }

  static async cancelDownload(modelName: string): Promise<CancelDownloadOutcome> {
    return await invoke('parakeet_cancel_download', { modelName });
  }

  static async deleteCorruptedModel(modelName: string): Promise<string> {
    return await invoke('parakeet_delete_corrupted_model', { modelName });
  }

  static async hasAvailableModels(): Promise<boolean> {
    return await invoke('parakeet_has_available_models');
  }

  static async validateModelReady(): Promise<string> {
    return await invoke('parakeet_validate_model_ready');
  }

  static async openModelsFolder(): Promise<void> {
    await invoke('open_parakeet_models_folder');
  }
}
