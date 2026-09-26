'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PermissionStatus, OnboardingPermissions } from '@/types/onboarding';

export const STARTER_TRANSCRIPTION_MODEL = 'tiny';
export const STARTER_SUMMARY_MODEL = 'gemma3:1b';

interface OnboardingStatus {
  version: string;
  completed: boolean;
  current_step: number;
  model_status: {
    parakeet: string; // Kept for compatibility with existing saved onboarding data.
    transcription?: string;
    summary: string;
    selected_summary_model?: string;
  };
  last_updated: string;
}

interface OnboardingContextType {
  currentStep: number;
  whisperReady: boolean;
  setWhisperReady: (ready: boolean) => void;
  summaryModelDownloaded: boolean;
  setSummaryModelDownloaded: (ready: boolean) => void;
  selectedSummaryModel: string;
  permissions: OnboardingPermissions;
  permissionsSkipped: boolean;
  goToStep: (step: number) => void;
  goNext: () => void;
  goPrevious: () => void;
  setPermissionStatus: (permission: keyof OnboardingPermissions, status: PermissionStatus) => void;
  setPermissionsSkipped: (skipped: boolean) => void;
  completeOnboarding: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export async function isStarterTranscriptionReady(): Promise<boolean> {
  await invoke('whisper_init');
  const models = await invoke<Array<{ name: string; status: unknown }>>('whisper_get_available_models');
  return models.some((model) => model.name === STARTER_TRANSCRIPTION_MODEL && model.status === 'Available');
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [whisperReady, setWhisperReady] = useState(false);
  const [summaryModelDownloaded, setSummaryModelDownloaded] = useState(false);
  const [selectedSummaryModel, setSelectedSummaryModel] = useState(STARTER_SUMMARY_MODEL);
  const [permissions, setPermissions] = useState<OnboardingPermissions>({
    microphone: 'not_determined',
    systemAudio: 'not_determined',
    screenRecording: 'not_determined',
  });
  const [permissionsSkipped, setPermissionsSkipped] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [legacyParakeetStatus, setLegacyParakeetStatus] = useState('not_downloaded');
  const completingRef = useRef(false);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const firstLaunch = await invoke<boolean>('check_first_launch');
        if (firstLaunch) await invoke('initialize_fresh_database');

        const saved = await invoke<OnboardingStatus | null>('get_onboarding_status');
        const model = saved?.completed && saved.model_status.selected_summary_model
          ? saved.model_status.selected_summary_model
          : STARTER_SUMMARY_MODEL;
        const [speechReady, notesReady] = await Promise.all([
          isStarterTranscriptionReady().catch(() => false),
          invoke<boolean>('builtin_ai_is_model_ready', { modelName: model, refresh: true }).catch(() => false),
        ]);
        if (!active) return;
        setCurrentStep(Math.min(Math.max(saved?.current_step || 1, 1), 4));
        setCompleted(Boolean(saved?.completed));
        setLegacyParakeetStatus(saved?.model_status.parakeet || 'not_downloaded');
        setSelectedSummaryModel(model);
        setWhisperReady(speechReady);
        setSummaryModelDownloaded(notesReady);
      } catch (error) {
        console.error('[OnboardingContext] Setup initialization failed:', error);
      } finally {
        if (active) setInitialized(true);
      }
    };
    void initialize();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!initialized || completed || completingRef.current) return;
    const timer = setTimeout(() => {
      if (completingRef.current) return;
      const status: OnboardingStatus = {
        version: '1.1',
        completed: false,
        current_step: currentStep,
        model_status: {
          parakeet: legacyParakeetStatus,
          transcription: whisperReady ? 'downloaded' : 'not_downloaded',
          summary: summaryModelDownloaded ? 'downloaded' : 'not_downloaded',
          selected_summary_model: selectedSummaryModel,
        },
        last_updated: new Date().toISOString(),
      };
      void invoke('save_onboarding_status_cmd', { status }).catch((error) => {
        console.error('[OnboardingContext] Could not save setup progress:', error);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [currentStep, whisperReady, summaryModelDownloaded, selectedSummaryModel, legacyParakeetStatus, completed, initialized]);

  const completeOnboarding = useCallback(async () => {
    if (completingRef.current) return;
    completingRef.current = true;
    try {
      if (!(await isStarterTranscriptionReady())) {
        setWhisperReady(false);
        throw new Error('Whisper Tiny is needed before finishing setup. Download it here first.');
      }
      const notesReady = await invoke<boolean>('builtin_ai_is_model_ready', {
        modelName: selectedSummaryModel,
        refresh: true,
      }).catch(() => false);
      setSummaryModelDownloaded(notesReady);
      await invoke('complete_onboarding', { model: selectedSummaryModel, summaryReady: notesReady });
      setWhisperReady(true);
      setCompleted(true);
    } finally {
      completingRef.current = false;
    }
  }, [selectedSummaryModel]);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.max(1, Math.min(step, 4)));
  }, []);
  const goNext = useCallback(() => setCurrentStep((step) => Math.min(step + 1, 4)), []);
  const goPrevious = useCallback(() => setCurrentStep((step) => Math.max(step - 1, 1)), []);
  const setPermissionStatus = useCallback((permission: keyof OnboardingPermissions, status: PermissionStatus) => {
    setPermissions((previous) => ({ ...previous, [permission]: status }));
  }, []);

  return (
    <OnboardingContext.Provider value={{
      currentStep,
      whisperReady,
      setWhisperReady,
      summaryModelDownloaded,
      setSummaryModelDownloaded,
      selectedSummaryModel,
      permissions,
      permissionsSkipped,
      goToStep,
      goNext,
      goPrevious,
      setPermissionStatus,
      setPermissionsSkipped,
      completeOnboarding,
    }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error('useOnboarding must be used within OnboardingProvider');
  return context;
}
