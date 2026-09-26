'use client';

import { useEffect, useMemo, useState, useRef, useId } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { useConfig } from '@/contexts/ConfigContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { activateModel, activateNotesModel } from '@/lib/model-activation';
import { loadModelSources, modelSources, modelLabel, type ModelChoice, type ModelPurpose, type SourceState } from '@/lib/model-choices';
import type { ModelConfig } from '@/components/ModelSettingsModal';

type Props = {
  purpose: ModelPurpose;
  onGetMore?: () => void;
  onSaved?: (config: ModelConfig) => void;
  presentation?: 'popover' | 'dialog';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
  message?: string;
  returnFocus?: () => void;
};

/** The same ready-to-use choices at every entry point. Settings owns downloads and connections. */
export function ModelPicker({ purpose, onGetMore, onSaved, presentation = 'popover', open: controlledOpen, onOpenChange, disabled, compact, message, returnFocus }: Props) {
  const router = useRouter();
  const popupId = useId();
  const { modelConfig, transcriptModelConfig, providerApiKeys, setModelConfig } = useConfig();
  const current = purpose === 'notes' ? modelConfig : transcriptModelConfig;
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const [states, setStates] = useState<Record<string, SourceState>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const loaders = useRef<(() => void)[]>([]);
  const sources = useMemo(() => modelSources(purpose, providerApiKeys, modelConfig.ollamaEndpoint, modelConfig.provider), [purpose, providerApiKeys, modelConfig.ollamaEndpoint, modelConfig.provider]);
  useEffect(() => {
    if (!open) return;
    setStates({}); setError('');
    loaders.current.push(loadModelSources(sources, state => setStates(prev => ({ ...prev, [state.source.id]: state }))));
    return () => { loaders.current.forEach(stop => stop()); loaders.current = []; };
  }, [open, sources]);
  const choose = async (choice: ModelChoice) => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      if (choice.provider === 'localWhisper' || choice.provider === 'parakeet') await activateModel(choice.provider, choice.model);
      else {
        const saved = await activateNotesModel({ ...choice.config, provider: choice.provider, model: choice.model }, (providerApiKeys as Record<string, string | null>)[choice.provider]);
        setModelConfig(saved); onSaved?.(saved);
      }
      setOpen(false);
    } catch {
      setError('Couldn’t save this choice. Your previous model is still in use. Try again.');
    } finally { setSaving(false); }
  };
  const getMore = () => {
    setOpen(false);
    if (onGetMore) onGetMore();
    else {
      sessionStorage.setItem('tetro.settingsTab', 'models');
      sessionStorage.setItem('tetro.modelsSection', purpose === 'transcription' ? 'transcription' : ['openai', 'claude', 'groq', 'openrouter', 'ollama', 'custom-openai'].includes(current.provider) ? 'external' : 'summary');
      router.push('/settings');
    }
  };
  const title = purpose === 'notes' ? 'Summary model' : 'Transcription model';
  const ordered = sources.map(s => states[s.id]).filter(Boolean);
  const loading = ordered.some(s => s.status === 'loading') || ordered.length < sources.length;
  const hasChoices = ordered.some(s => s.options.length);
  const disconnected = purpose === 'notes' && ['openai', 'claude', 'groq', 'openrouter'].includes(current.provider) && !(providerApiKeys as Record<string, string | null>)[current.provider]?.trim();
  const missing = open && current.model && ordered.find(s => s.source.id === current.provider)?.status === 'ready' && !ordered.some(s => s.options.some(o => o.provider === current.provider && o.model === current.model));
  const label = current.model ? modelLabel(current.provider, current.model) : 'Choose a model';
  const content = <div className="tetro-chooser">
    {message && <p className="tetro-chooser-message">{message}</p>}
    <Command>
      <CommandInput placeholder="Search models…" aria-label={`Search ${title.toLowerCase()}s`} />
      <CommandList className="max-h-[310px]" aria-label={title}>
        <CommandEmpty>{loading && !hasChoices ? 'Looking for installed models…' : 'No matching models. Get more models below.'}</CommandEmpty>
        {ordered.filter(s => s.options.length).map(s => <CommandGroup key={s.source.id} heading={s.source.label}>
          {s.options.map(o => {
            const selected = current.provider === o.provider && current.model === o.model;
            return <CommandItem key={`${o.provider}:${o.model}`} value={`${s.source.label} ${o.label} ${o.model}`} disabled={saving} onSelect={() => void choose(o)}>
              <Check aria-hidden="true" className={`mr-2 h-4 w-4 shrink-0 ${selected ? '' : 'opacity-0'}`} />
              <span className="min-w-0 flex-1"><span className="block truncate">{o.label}</span><small className="block text-muted-foreground">{o.detail}</small></span>
              {selected && <span className="tetro-choice-current">In use</span>}
            </CommandItem>;
          })}
        </CommandGroup>)}
      </CommandList>
    </Command>
    <div className="tetro-chooser-status" aria-live="polite">
      {saving && <p><Loader2 className="h-3 w-3 animate-spin" />Saving choice…</p>}
      {loading && hasChoices && <p>Checking other sources…</p>}
      {ordered.filter(s => s.status === 'error').map(s => <p key={s.source.id}>Can’t reach {s.source.label}. <button type="button" disabled={saving} className="tetro-link" onClick={() => { loaders.current.push(loadModelSources([s.source], state => setStates(prev => ({ ...prev, [state.source.id]: state })))); }}>Retry</button></p>)}
      {disconnected && <p>Connect this service in Models → External models, or choose an installed model.</p>}
      {missing && !disconnected && <p>Your saved model isn’t available. Choose another or get more models below.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    <button type="button" className="tetro-chooser-more" disabled={saving} onClick={getMore}>Get more models…</button>
  </div>;
  if (presentation === 'dialog') return <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}><DialogContent className="tetro-chooser-dialog" onCloseAutoFocus={event => { if (returnFocus) { event.preventDefault(); returnFocus(); } }}>
    <DialogTitle>{title}</DialogTitle><DialogDescription>Choose a model that’s ready to use.</DialogDescription>{content}
  </DialogContent></Dialog>;
  return <Popover open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
    <PopoverTrigger asChild><button type="button" disabled={disabled} aria-label={`${title}: ${label}`} role="combobox" aria-expanded={open} aria-controls={popupId} aria-haspopup="dialog" className={compact ? 'tetro-key tetro-chooser-trigger' : 'tetro-model-picker'} title={`${title}: ${label}`}>
      <span className="tetro-model-picker-value">{compact ? 'Model' : label}</span>{disconnected && !compact && <small className="is-warn">Not connected</small>}<ChevronsUpDown className="h-3 w-3 shrink-0" />
    </button></PopoverTrigger><PopoverContent id={popupId} className="tetro-chooser-popover" align="end">{content}</PopoverContent>
  </Popover>;
}
