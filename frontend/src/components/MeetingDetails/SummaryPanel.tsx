"use client";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

import { SummaryFooter } from '@/components/tetro/SummaryFooter';
import { TapeLoader } from '@/components/tetro/TapeLoader';
import { useTemplateSuggestion } from '@/hooks/useTemplateSuggestion';
import { MeetingSummary, Summary, Transcript } from '@/types';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SummaryGeneratorButtonGroup } from './SummaryGeneratorButtonGroup';

import { useEffect, useMemo, useRef, useState, RefObject } from 'react';
import { toast } from 'sonner';
import { Languages } from 'lucide-react';
import { LanguagePickerPopover } from '@/components/LanguagePickerPopover';
import { useRecentLanguages } from '@/hooks/useRecentLanguages';
import { labelForCode } from '@/lib/summary-languages';
import {
  readMeetingSummaryLanguage,
  saveMeetingSummaryLanguage,
  SummaryLanguageStorage,
} from '@/lib/summary-language-preferences';
import { hasVisibleSummaryContent } from '@/lib/summary-content';
import { useRouter } from 'next/navigation';
import { openSummaryModelChoices } from '@/lib/model-settings-route';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  isSummaryDirty: boolean;
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onExportSummary: (includeTranscript?: boolean, format?: 'md' | 'pdf') => Promise<void>;
  isExporting: boolean;
  aiSummary: MeetingSummary | null;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  onPromptChange?: (value: string) => void;
  onSaveSummary: (summary: MeetingSummary) => Promise<void>;
  onSummaryChange: (summary: Summary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (status: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error') => string;
  availableTemplates: Array<{ id: string, name: string, description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
}

export function SummaryPanel({
  meeting,
  meetingTitle,
  isSummaryDirty,
  summaryRef,
  isSaving,
  onSaveAll,
  onCopySummary,
  onExportSummary,
  isExporting,
  aiSummary,
  summaryStatus,
  transcripts,
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  onPromptChange,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryError,
  onRegenerateSummary,
  getSummaryStatusMessage,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  isModelConfigLoading = false,
  onOpenModelSettings,
}: SummaryPanelProps) {
  const router = useRouter();
  const chooseModel = () => openSummaryModelChoices(href => router.push(href));
  const [summaryLang, setSummaryLang] = useState<string | null>(null);
  const [hasReadyModel, setHasReadyModel] = useState(false);
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!modelConfig.model?.trim()) { if (active) setHasReadyModel(false); return; }
      if (!['builtin-ai', 'local-llama', 'localllama'].includes(modelConfig.provider)) { if (active) setHasReadyModel(true); return; }
      const ready = await invoke<boolean>('builtin_ai_is_model_ready', { modelName: modelConfig.model, refresh: false }).catch(() => false);
      if (active) setHasReadyModel(ready);
    };
    void check();
    const unlisten = listen<{ model: string; status: string }>('builtin-ai-download-progress', event => {
      if (event.payload.model === modelConfig.model && event.payload.status === 'completed') void check();
    });
    return () => { active = false; void unlisten.then(fn => fn()); };
  }, [modelConfig.provider, modelConfig.model]);
  const [summaryLangStorage, setSummaryLangStorage] = useState<SummaryLanguageStorage>('metadata');
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [languageSaving, setLanguageSaving] = useState(false);
  const languageLoadVersionRef = useRef(0);
  const activeMeetingIdRef = useRef(meeting.id);
  const languageSaveVersionRef = useRef(0);
  const languageSaveLoopRunningRef = useRef(false);
  const confirmedLanguageRef = useRef<{ language: string | null; storage: SummaryLanguageStorage }>({ language: null, storage: 'metadata' });
  const latestLanguageSaveRequestRef = useRef<{
    version: number;
    meetingId: string;
    language: string | null;
  } | null>(null);
  activeMeetingIdRef.current = meeting.id;
  const { addRecent } = useRecentLanguages();

  const effectiveLangLabel = summaryLang ? labelForCode(summaryLang) : 'Auto';
  const isLocalFallbackLanguage = summaryLangStorage === 'local_fallback';
  const autoSubtitle = isLocalFallbackLanguage
    ? 'Saved on this device for folderless meetings'
    : 'Uses dominant transcript language';

  useEffect(() => {
    let cancelled = false;
    const loadVersion = languageLoadVersionRef.current + 1;
    languageLoadVersionRef.current = loadVersion;

    const loadSummaryLanguage = async () => {
      try {
        const stored = await readMeetingSummaryLanguage(meeting.id);
        if (!cancelled && languageLoadVersionRef.current === loadVersion) {
          setSummaryLang(stored.language);
          setSummaryLangStorage(stored.storage);
          confirmedLanguageRef.current = stored;
        }
      } catch (err) {
        console.error('Failed to load summary language:', err);
        toast.warning('Could not load saved summary language', {
          description: 'Using Auto until meeting metadata can be read.',
        });
        if (!cancelled && languageLoadVersionRef.current === loadVersion) setSummaryLang(null);
      }
    };

    loadSummaryLanguage();

    return () => {
      cancelled = true;
    };
  }, [meeting.id]);

  const persistLatestLanguageSelection = async () => {
    if (languageSaveLoopRunningRef.current) return;
    languageSaveLoopRunningRef.current = true;

    try {
      while (true) {
        const request = latestLanguageSaveRequestRef.current;
        if (!request) return;

        try {
          const saved = await saveMeetingSummaryLanguage(request.meetingId, request.language);
          if (activeMeetingIdRef.current === request.meetingId) confirmedLanguageRef.current = saved;
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            setSummaryLang(saved.language);
            setSummaryLangStorage(saved.storage);
            if (saved.storage === 'local_fallback') {
              toast.info('Summary language saved on this device', {
                description: 'This meeting has no recording folder, so the preference cannot be written to meeting metadata.',
              });
            }
            if (request.language) {
              addRecent(request.language);
            }
            return;
          }

          if (latest?.version === request.version) return;
        } catch (err) {
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            console.error('Failed to persist summary language:', err);
            toast.error('Failed to save summary language');
            setSummaryLang(confirmedLanguageRef.current.language);
            setSummaryLangStorage(confirmedLanguageRef.current.storage);
            return;
          }

          console.warn('Ignoring failed stale summary language save:', err);
          if (latest?.version === request.version) return;
        }
      }
    } finally {
      languageSaveLoopRunningRef.current = false;
      setLanguageSaving(false);
    }
  };

  const handleLangChange = (code: string | null) => {
    const nextStored = code;
    languageLoadVersionRef.current += 1;
    latestLanguageSaveRequestRef.current = {
      version: languageSaveVersionRef.current + 1,
      meetingId: meeting.id,
      language: nextStored,
    };
    languageSaveVersionRef.current += 1;
    setSummaryLang(nextStored);
    setLanguageSaving(true);
    setLangPickerOpen(false);
    void persistLatestLanguageSelection();
  };

  const transcriptText = useMemo(() => transcripts.map(t => t.text).join(' ').slice(0, 20000), [transcripts]);
  const generateWithSavedLanguage = async (prompt: string) => {
    if (!languageSaveLoopRunningRef.current) await onGenerateSummary(prompt);
  };
  const suggestedId = useTemplateSuggestion(transcriptText, availableTemplates.map(t => t.id), !hasVisibleSummaryContent(aiSummary));
  const suggestedTemplate = availableTemplates.find(t => t.id === suggestedId) ?? null;

  const isSummaryLoading = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';
  const hasSummary = hasVisibleSummaryContent(aiSummary);

  const languageTrigger = useRef<HTMLButtonElement | null>(null);
  const languageSlot = <button type="button" className="tetro-key" disabled={isSummaryLoading} title={`Summary language: ${effectiveLangLabel}`} aria-label={`Summary language: ${effectiveLangLabel}`} onClick={event => { languageTrigger.current = event.currentTarget; setLangPickerOpen(true); }}><Languages size={14} /><span>{effectiveLangLabel}</span></button>;

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden h-full w-full @container">
      <div className="tetro-pane-toolbar">
        <SummaryGeneratorButtonGroup
          modelConfig={modelConfig} hasModel={hasReadyModel} setModelConfig={setModelConfig} onSaveModelConfig={onSaveModelConfig}
          onGenerateSummary={generateWithSavedLanguage} onChooseModel={chooseModel} onStopGeneration={onStopGeneration} customPrompt={customPrompt}
          languageSaving={languageSaving} languageLabel={effectiveLangLabel}
          summaryStatus={summaryStatus} availableTemplates={availableTemplates} selectedTemplate={selectedTemplate}
          onTemplateSelect={onTemplateSelect} hasTranscripts={transcripts.length > 0} hasSummary={hasSummary}
          isModelConfigLoading={isModelConfigLoading} onOpenModelSettings={onOpenModelSettings}
          languageSlot={languageSlot} onOpenLanguage={trigger => { languageTrigger.current = trigger; setLangPickerOpen(true); }}
          meetingId={meeting.id} onPromptChange={onPromptChange} isSaving={isSaving} isDirty={isSummaryDirty}
          onSave={onSaveAll} onCopy={onCopySummary} onExport={onExportSummary} isExporting={isExporting}
        />
      </div>
      <Dialog open={langPickerOpen} onOpenChange={setLangPickerOpen}><DialogContent className="tetro-language-dialog" onCloseAutoFocus={event => { event.preventDefault(); languageTrigger.current?.focus(); }}>
        <DialogTitle>Summary language</DialogTitle><DialogDescription>Choose the language Tetro writes this summary in.</DialogDescription>
        <LanguagePickerPopover value={summaryLang} onChange={handleLangChange} onClose={() => setLangPickerOpen(false)} autoSubtitle={autoSubtitle} />
      </DialogContent></Dialog>

      {isSummaryLoading ? (
        <TapeLoader {...loaderText(modelConfig, summaryStatus === 'regenerating')} onCancel={onStopGeneration} />
      ) : !hasSummary ? (
        <EmptyStateSummary
          hasTranscript={transcripts.length > 0}
          suggestion={suggestedTemplate && suggestedTemplate.id !== selectedTemplate ? { name: suggestedTemplate.name, onUse: () => onTemplateSelect(suggestedTemplate.id, suggestedTemplate.name) } : null}
          onGenerate={() => generateWithSavedLanguage(customPrompt)}
          hasModel={hasReadyModel}
          isGenerating={isSummaryLoading || languageSaving}
          error={summaryError}
        />
      ) : (
        <div className="tetro-summary-scroll">
          <div className="w-full">
            <BlockNoteSummaryView
              ref={summaryRef}
              summaryData={aiSummary}
              onSave={onSaveSummary}
              onSummaryChange={onSummaryChange}
              onDirtyChange={onDirtyChange}
              status={summaryStatus}
              error={summaryError}
              onRegenerateSummary={() => {

                if (!languageSaveLoopRunningRef.current) onRegenerateSummary();
              }}
              meeting={{
                id: meeting.id,
                title: meetingTitle,
                created_at: meeting.created_at
              }}
            />
          </div>
          {summaryStatus === 'error'
            ? <p className="tetro-summary-footer is-error" role="alert">{getSummaryStatusMessage(summaryStatus)}</p>
            : <SummaryFooter meetingId={meeting.id} refreshKey={summaryStatus} />}
        </div>
      )}
    </div>
  );
}

const PROVIDER_NAME: Record<string, string> = { openai: 'OpenAI', claude: 'Anthropic', groq: 'Groq', openrouter: 'OpenRouter', 'custom-openai': 'your custom endpoint' };

/** Says exactly what is happening and where, so people can judge how long it will take. */
function loaderText(config: { provider: string; model: string; ollamaEndpoint?: string | null }, again: boolean) {
  const action = again ? 'Summarizing again' : 'Summarizing the meeting';
  const model = config.model || 'your summary model';
  if (config.provider === 'builtin-ai' || config.provider === 'local-llama') {
    return { label: `${action} with ${model}`, detail: 'Running locally on this device. Long meetings can take a few minutes.' };
  }
  if (config.provider === 'ollama') {
    const local = !config.ollamaEndpoint || /localhost|127\.0\.0\.1/.test(config.ollamaEndpoint);
    return { label: `${action} with ${model}`, detail: local ? 'Running locally through Ollama. Long meetings can take a few minutes.' : 'Running on your Ollama server.' };
  }
  return { label: `${action} with ${model}`, detail: `Sent to ${PROVIDER_NAME[config.provider] ?? config.provider}. Usually under a minute.` };
}
