'use client';

import type { ModelConfig } from '@/components/ModelSettingsModal';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Sparkles, Square, Loader2, MoreHorizontal, Save, FileText, Languages, SlidersHorizontal, History, MessageSquarePlus, Copy, FileDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ModelPicker } from '@/components/tetro/ModelPicker';
import { MeetingVersions } from '@/components/tetro/MeetingVersions';
import { NotesInstructions } from '@/components/tetro/NotesInstructions';
import { isEverydayTemplate } from '@/lib/template-catalog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';

interface SummaryGeneratorButtonGroupProps {
  languageSlot?: ReactNode;
  languageSaving?: boolean;
  languageLabel?: string;
  onOpenLanguage?: (trigger: HTMLButtonElement | null) => void;
  modelConfig: ModelConfig;
  hasModel: boolean;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onChooseModel: () => void;
  onStopGeneration: () => void;
  customPrompt: string;
  onPromptChange?: (prompt: string) => void;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  availableTemplates: Array<{ id: string; name: string; description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  hasTranscripts?: boolean;
  hasSummary?: boolean;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
  meetingId: string;
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onExport: (includeTranscript?: boolean, format?: 'md' | 'pdf') => Promise<void>;
  isExporting: boolean;
}

/** The primary action stays visible. More holds occasional actions without adding another row. */
export function SummaryGeneratorButtonGroup({ hasModel, setModelConfig, onGenerateSummary, onChooseModel, onStopGeneration, customPrompt, onPromptChange, summaryStatus, availableTemplates, selectedTemplate, onTemplateSelect, hasTranscripts = true, hasSummary = false, isModelConfigLoading, onOpenModelSettings, languageSlot, languageSaving, languageLabel = 'Auto', onOpenLanguage, meetingId, isSaving, isDirty, onSave, onCopy, onExport, isExporting }: SummaryGeneratorButtonGroupProps) {
  const moreButton = useRef<HTMLButtonElement>(null);
  const returnFocus = () => moreButton.current?.focus();
  const [modelOpen, setModelOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  useEffect(() => { onOpenModelSettings?.(() => setModelOpen(true)); }, [onOpenModelSettings]);
  const generating = ['processing', 'summarizing', 'regenerating'].includes(summaryStatus);
  return <div className="tetro-notes-toolbar" data-editing={isDirty || isSaving || undefined}>
    {hasTranscripts && (generating ? <button className="tetro-key tetro-danger" onClick={onStopGeneration} aria-label="Stop summarizing"><Square size={14} fill="currentColor" />Stop</button>
      : <button className={`tetro-key ${hasSummary ? 'tetro-key-amber' : ''} tetro-notes-primary`} disabled={isModelConfigLoading || isSaving || languageSaving} title={hasModel ? `Summary language: ${languageLabel}` : 'Choose a summary model'} onClick={() => { if (hasModel) void onGenerateSummary(customPrompt); else onChooseModel(); }}>
        {isModelConfigLoading || languageSaving ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{languageSaving ? 'Saving language…' : isModelConfigLoading ? 'Loading…' : !hasModel ? 'Choose summary model' : hasSummary ? 'Write again' : 'Write summary'}
      </button>)}
    {hasTranscripts && availableTemplates.length > 0 && <Select value={selectedTemplate} disabled={generating} onValueChange={value => { const t = availableTemplates.find(item => item.id === value); if (t) onTemplateSelect(t.id, t.name); }}>
      <SelectTrigger className="tetro-template-select" aria-label="Summary template" title="Summary template"><FileText size={14} aria-hidden="true" /><SelectValue placeholder="Choose template" /></SelectTrigger>
      <SelectContent className="tetro-template-options" position="popper" align="start">
        {availableTemplates.some(t => isEverydayTemplate(t.id)) && <SelectGroup><SelectLabel>Everyday</SelectLabel>{availableTemplates.filter(t => isEverydayTemplate(t.id)).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectGroup>}
        {availableTemplates.some(t => !isEverydayTemplate(t.id)) && <SelectGroup><SelectLabel>More templates</SelectLabel>{availableTemplates.filter(t => !isEverydayTemplate(t.id)).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectGroup>}
      </SelectContent>
    </Select>}
    {(hasTranscripts || hasSummary) && <>
      <span className="tetro-notes-wide">{languageSlot}</span>
      <span className="tetro-notes-wide"><ModelPicker purpose="notes" compact disabled={generating} onSaved={setModelConfig} /></span>
    </>}
    {(isDirty || isSaving) && !generating && <button className="tetro-key tetro-save-notes" disabled={isSaving} onClick={() => void onSave()} aria-label="Save summary">{isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{isSaving ? 'Saving…' : 'Save edits'}</button>}
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><button ref={moreButton} className="tetro-key tetro-notes-more" aria-label="More summary actions">More<MoreHorizontal size={14} /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={event => { if (modelOpen || versionsOpen || instructionsOpen) event.preventDefault(); }}>
        <DropdownMenuItem disabled={generating} onSelect={() => onOpenLanguage?.(moreButton.current)}><Languages className="mr-2 h-4 w-4" />Summary language · {languageLabel}</DropdownMenuItem>
        <DropdownMenuItem disabled={generating} onSelect={() => setModelOpen(true)}><SlidersHorizontal className="mr-2 h-4 w-4" />Summary model</DropdownMenuItem>
        {onPromptChange && <DropdownMenuItem disabled={generating} onSelect={() => setInstructionsOpen(true)}><MessageSquarePlus className="mr-2 h-4 w-4" />Instructions{customPrompt.trim() ? ' · set' : ''}</DropdownMenuItem>}
        <DropdownMenuItem disabled={generating} onSelect={() => setVersionsOpen(true)}><History className="mr-2 h-4 w-4" />Previous versions</DropdownMenuItem>
        {hasSummary && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void onCopy()}><Copy className="mr-2 h-4 w-4" />Copy summary</DropdownMenuItem>
          <DropdownMenuItem disabled={isExporting} onSelect={() => void onExport(false, 'pdf')}><FileDown className="mr-2 h-4 w-4" />Save as PDF</DropdownMenuItem>
          <DropdownMenuItem disabled={isExporting} onSelect={() => void onExport(true, 'pdf')}>PDF with transcript</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isExporting} onSelect={() => void onExport(false)}>Export as Markdown</DropdownMenuItem>
          <DropdownMenuItem disabled={isExporting} onSelect={() => void onExport(true)}>Markdown with transcript</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
    <ModelPicker purpose="notes" presentation="dialog" open={modelOpen} onOpenChange={setModelOpen} onSaved={setModelConfig} returnFocus={returnFocus} />
    <MeetingVersions meetingId={meetingId} kind="summary" canRestore={!isDirty && !isSaving} open={versionsOpen} onOpenChange={setVersionsOpen} returnFocus={returnFocus} hideTrigger />
    {onPromptChange && <NotesInstructions value={customPrompt} onChange={onPromptChange} onApply={v => void onGenerateSummary(v)} hasNotes={hasSummary} disabled={isModelConfigLoading || languageSaving} open={instructionsOpen} onOpenChange={setInstructionsOpen} returnFocus={returnFocus} hideTrigger />}
  </div>;
}
