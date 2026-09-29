'use client';

import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { RECOMMENDED_SUMMARY_MODEL } from '@/lib/recommended-models';
import { SettingGroup, SettingRow } from '@/components/tetro/SettingRow';
import { VocabularyEditor } from '@/components/tetro/Vocabulary';
import { OllamaModels, CustomServer } from '@/components/tetro/ModelSources';
import { ModelPicker } from './ModelPicker';
import { ModelManager } from '@/components/WhisperModelManager';
import { ParakeetModelManager } from '@/components/ParakeetModelManager';
import { BuiltInModelManager } from '@/components/BuiltInModelManager';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useConfig } from '@/contexts/ConfigContext';
import { activateNotesModel } from '@/lib/model-activation';
import { loadModelSources, modelSources, type ModelChoice, type SourceState } from '@/lib/model-choices';
import { notesDestination } from '@/lib/model-privacy';

export type ModelsSection = 'transcription' | 'summary' | 'external';

/** All entry points share the same installed-model chooser. */
export function TranscriptionSettings({ onOpenModels }: { onOpenModels: () => void }) {
  const { showConfidenceIndicator, toggleConfidenceIndicator } = useConfig();
  return <div className="tetro-settings-stack">
    <SettingGroup title="Model"><SettingRow label="Transcription model" hint="Turns speech into text on this device.">
      <ModelPicker purpose="transcription" onGetMore={onOpenModels} />
    </SettingRow></SettingGroup>
    <SettingGroup title="Transcript display"><SettingRow label="Show confidence indicators" hint="Colored dots show which words may need a closer look."><Switch checked={showConfidenceIndicator} onCheckedChange={toggleConfidenceIndicator} aria-label="Show confidence indicators" /></SettingRow></SettingGroup>
    <VocabularyEditor />
  </div>;
}

const SECTIONS: { id: ModelsSection; label: string }[] = [
  { id: 'transcription', label: 'Transcription models' },
  { id: 'summary', label: 'Summary models' },
  { id: 'external', label: 'External models' },
];

/** Model management is organized by job, with connected services in their own section. */
export function ModelsSettings({ section, onSectionChange, browseSummaryOnOpen = false, browseTranscriptionOnOpen = false }: { section: ModelsSection; onSectionChange: (section: ModelsSection) => void; browseSummaryOnOpen?: boolean; browseTranscriptionOnOpen?: boolean }) {
  const { transcriptModelConfig, modelConfig, selectedLanguage } = useConfig();
  const [notesRecommendation, setNotesRecommendation] = useState(RECOMMENDED_SUMMARY_MODEL);
  useEffect(() => { let disposed = false; void invoke<string>('builtin_ai_get_recommended_model').then(model => { if (!disposed) setNotesRecommendation(model); }).catch(() => {}); return () => { disposed = true; }; }, []);
  const [browseTranscription, setBrowseTranscription] = useState(browseTranscriptionOnOpen);
  const transcriptionDownloads = useRef<HTMLElement>(null);
  useEffect(() => { if (browseTranscriptionOnOpen) setBrowseTranscription(true); }, [browseTranscriptionOnOpen]);
  useEffect(() => {
    if (!browseTranscription || section !== 'transcription') return;
    // Wait for the settings entrance animation before measuring its scroll container.
    const timer = window.setTimeout(() => {
      const heading = transcriptionDownloads.current;
      const scroller = heading?.closest<HTMLElement>('[data-settings-scroll]');
      if (!heading || !scroller) return;
      const top = scroller.scrollTop + heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
      scroller.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [browseTranscription, section]);
  const [browseSummary, setBrowseSummary] = useState(browseSummaryOnOpen);
  useEffect(() => { if (browseSummaryOnOpen) setBrowseSummary(true); }, [browseSummaryOnOpen]);
  const [summaryReady, setSummaryReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (modelConfig.provider !== 'builtin-ai' || !modelConfig.model) { setSummaryReady(null); return; }
    let active = true;
    const check = () => { void invoke<boolean>('builtin_ai_is_model_ready', { modelName: modelConfig.model, refresh: true }).then(ready => { if (active) setSummaryReady(ready); }).catch(() => { if (active) setSummaryReady(false); }); };
    check();
    const unlisten = listen<{ model: string; status: string }>('builtin-ai-download-progress', event => {
      if (event.payload.model === modelConfig.model && event.payload.status !== 'downloading') check();
    });
    return () => { active = false; void unlisten.then(fn => fn()); };
  }, [modelConfig.provider, modelConfig.model]);
  const [speechFamily, setSpeechFamily] = useState<'all' | 'parakeet' | 'whisper'>('all');
  const [speechCoverage, setSpeechCoverage] = useState<'all' | 'multilingual' | 'armenian' | 'english'>('all');
  const inUse = (provider: string) => transcriptModelConfig.provider === provider ? transcriptModelConfig.model : undefined;
  const speechProvider = ['auto', 'en', 'ru', 'hy'].includes(selectedLanguage) ? 'parakeet' : 'localWhisper';
  const speechRecommendation = selectedLanguage === 'hy' ? 'stt-fastconformer-armenian' : selectedLanguage === 'en' ? 'stt-parakeet-english' : 'stt-parakeet-multilingual';
  const summary = modelConfig.provider === 'builtin-ai' ? modelConfig.model : '';
  const recommendedParakeet = speechProvider === 'parakeet' ? speechRecommendation : '';
  const recommendedWhisper = speechProvider === 'localWhisper' ? 'small' : '';
  const matchesParakeet = (model: string) => speechCoverage === 'all'
    || (speechCoverage === 'multilingual' && model === 'stt-parakeet-multilingual')
    || (speechCoverage === 'armenian' && model === 'stt-fastconformer-armenian')
    || (speechCoverage === 'english' && model === 'stt-parakeet-english');
  const matchesWhisper = (model: string) => speechCoverage === 'all'
    || (speechCoverage === 'armenian' && model === 'large-v3-turbo-hy')
    || (speechCoverage === 'multilingual' && model !== 'large-v3-turbo-hy');
  const transcriptionRows = (scope: 'installed' | 'more') => <>
    {speechFamily !== 'whisper' && <ParakeetModelManager variant="rows" scope={scope} recommendedId={recommendedParakeet} selectedModel={inUse('parakeet')} filterModel={matchesParakeet} />}
    {speechFamily !== 'parakeet' && <ModelManager variant="rows" scope={scope} recommendedId={recommendedWhisper} selectedModel={inUse('localWhisper')} filterModel={matchesWhisper} />}
  </>;
  const summaryRows = (scope: 'installed' | 'more') =>
    <BuiltInModelManager variant="rows" scope={scope} recommendedId={notesRecommendation} autoSelect={false} selectedModel={summary} onModelSelect={() => {}} />;
  return <div className="tetro-settings-stack tetro-models">
    <nav className="tetro-model-sections" aria-label="Model categories">
      {SECTIONS.map(item => <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => onSectionChange(item.id)}>
        <strong>{item.label}</strong>
      </button>)}
    </nav>
    {section === 'transcription' && <div className="tetro-model-section" aria-labelledby="tetro-model-transcription-heading">
      <h2 id="tetro-model-transcription-heading">Transcription models</h2>
      <p>Turn recorded speech into text on this device. Sizes are downloads; speed and accuracy vary with your computer, language and audio quality.</p>
      <SettingGroup title="Current model"><SettingRow label="Transcription model"><ModelPicker purpose="transcription" onGetMore={() => setBrowseTranscription(true)} /></SettingRow></SettingGroup>
      <div className="tetro-model-browse-filters">
        <label>Model family <select value={speechFamily} onChange={event => { const next = event.target.value as typeof speechFamily; setSpeechFamily(next); if (next === 'whisper' && speechCoverage === 'english') setSpeechCoverage('all'); }}><option value="all">All families</option><option value="parakeet">Parakeet and FastConformer</option><option value="whisper">Whisper</option></select></label>
        <label>Language focus <select value={speechCoverage} onChange={event => { const next = event.target.value as typeof speechCoverage; setSpeechCoverage(next); if (next === 'english' && speechFamily === 'whisper') setSpeechFamily('all'); }}><option value="all">All languages</option><option value="multilingual">Multilingual</option><option value="armenian">Armenian focused</option><option value="english">English only</option></select></label>
      </div>
      <SettingGroup title="Installed on this device">{transcriptionRows('installed')}</SettingGroup>
      <details className="tetro-model-disclosure" open={browseTranscription} onToggle={event => setBrowseTranscription(event.currentTarget.open)}>
        <summary ref={transcriptionDownloads} style={{ scrollMarginTop: 24 }}>Download transcription models <span>Download another language, family or size</span></summary>
        {browseTranscription && <div className="tetro-model-disclosure-body">{transcriptionRows('more')}<p className="tetro-setting-note tetro-model-no-matches">No other models match these filters. Try another language or family.</p></div>}
      </details>
    </div>}
    {section === 'summary' && <div className="tetro-model-section" aria-labelledby="tetro-model-summary-heading">
      <h2 id="tetro-model-summary-heading">Summary models</h2>
      <p>Write summaries and draft templates on this device. Sizes are downloads; running a model needs additional memory. “Context” is the amount of text it can work with at once.</p>
      <SettingGroup title="Current model"><SettingRow label="Summary model" hint={modelConfig.provider === 'builtin-ai' ? !modelConfig.model ? 'Choose a model to write summaries.' : summaryReady === false ? 'Download needed. Resume below or choose another model.' : 'Runs on this device.' : <>{notesDestination(modelConfig.provider, modelConfig.ollamaEndpoint)}. <button type="button" className="tetro-link" onClick={() => onSectionChange('external')}>View external model</button></>}><ModelPicker purpose="notes" onGetMore={() => setBrowseSummary(true)} /></SettingRow></SettingGroup>
      <SettingGroup title="Installed on this device">{summaryRows('installed')}</SettingGroup>
      <details className="tetro-model-disclosure" open={browseSummary} onToggle={event => setBrowseSummary(event.currentTarget.open)}>
        <summary>Browse summary models <span>Download another model for this device</span></summary>
        {browseSummary && <div className="tetro-model-disclosure-body">{summaryRows('more')}</div>}
      </details>
      <button type="button" className="tetro-link" onClick={() => onSectionChange('external')}>Connect or choose an external summary model</button>
    </div>}
    {section === 'external' && <div className="tetro-model-section" aria-labelledby="tetro-model-external-heading">
      <h2 id="tetro-model-external-heading">External models</h2>
      <p>Connect a provider or server for summaries.</p>
      <SettingGroup title="Providers"><ProviderKeys /></SettingGroup>
      <SettingGroup title="Your own server"><OllamaModels /><CustomServer /></SettingGroup>
      <p className="tetro-setting-note">Keys are stored on this device and sent to the provider to authenticate requests. Using a connected summary model sends transcript text and instructions to that provider, including for automatic meeting names and speaker labels.</p>
    </div>}
  </div>;
}

type SummaryProviderId = 'openrouter' | 'claude' | 'openai' | 'groq';
type ProviderId = SummaryProviderId;
const PROVIDERS: { id: ProviderId; name: string; hint: string; check?: string; capability: string }[] = [
  { id: 'openai', name: 'OpenAI · GPT', hint: 'Choose a GPT model for summaries.', check: 'get_openai_models', capability: 'Audio transcription isn’t connected yet.' },
  { id: 'claude', name: 'Anthropic · Claude', hint: 'Choose a Claude model for summaries.', check: 'get_anthropic_models', capability: 'Audio transcription isn’t available here.' },
  { id: 'openrouter', name: 'OpenRouter', hint: 'Choose a summary model from several providers.', capability: 'Audio transcription isn’t connected yet.' },
  { id: 'groq', name: 'Groq', hint: 'Choose a hosted summary model.', check: 'get_groq_models', capability: 'Audio transcription isn’t connected yet.' },
];

/** Connect each provider once; its usable Tetro job is displayed beside it. */
function ProviderKeys() {
  return <>
    {PROVIDERS.map(p => <div key={p.id} className="tetro-external-provider">
      <ProviderKeyRow {...p} />
      <p className="tetro-external-capability">{p.capability}</p>
      <ProviderCatalog id={p.id} name={p.name} />
    </div>)}
  </>;
}

function ProviderKeyRow({ id, name, hint, check }: { id: ProviderId; name: string; hint: string; check?: string }) {
  const { providerApiKeys, updateProviderApiKey } = useConfig();
  const saved = providerApiKeys[id];
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    try {
      // Where the provider can list models, check before saving. The catalog command must return errors instead of fallback models.
      if (check) await invoke(check, { apiKey: key });
      await invoke('api_save_api_key', { provider: id, apiKey: key });
      updateProviderApiKey(id, true);
      setDraft(''); setEditing(false);
    } catch (e) {
      toast.error(`Couldn’t connect ${name}`, { description: String(e) });
    } finally { setBusy(false); }
  };
  const remove = async () => {
    try {
      await invoke('api_delete_api_key', { provider: id });
      updateProviderApiKey(id, false);
    } catch (e) {
      toast.error(`Couldn’t remove the ${name} key`, { description: String(e) });
    }
  };

  const label = <span className="tetro-provider-name"><i className={saved ? 'is-on' : ''} aria-hidden="true" />{name} <small className="tetro-provider-status">{saved ? 'Key saved' : 'Not connected'}</small></span>;
  return (
    <SettingRow label={label} hint={hint}>
      {saved && !editing ? <>
        <code className="tetro-key-mask" aria-label="Saved key">Saved securely</code>
        <button type="button" className="tetro-key" onClick={() => setEditing(true)}>Replace</button>
        <button type="button" className="tetro-key" onClick={remove}>Remove</button>
      </> : <form className="tetro-key-form" onSubmit={e => { e.preventDefault(); void connect(); }}>
        <Input type="password" autoComplete="off" spellCheck={false} placeholder="Paste API key" aria-label={`${name} API key`} value={draft} onChange={e => setDraft(e.target.value)} />
        <button type="submit" className="tetro-key" disabled={!draft.trim() || busy}>{busy ? 'Checking…' : 'Connect'}</button>
        {editing && <button type="button" className="tetro-key" onClick={() => { setEditing(false); setDraft(''); }}>Cancel</button>}
      </form>}
    </SettingRow>
  );
}

function ProviderCatalog({ id, name }: { id: SummaryProviderId; name: string }) {
  const { providerApiKeys, modelConfig, setModelConfig } = useConfig();
  const key = providerApiKeys[id];
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SourceState>();
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState<string>();
  useEffect(() => {
    if (!open || !key) { setState(undefined); return; }
    const source = modelSources('notes', { [id]: key }, modelConfig.ollamaEndpoint, modelConfig.provider).find(candidate => candidate.id === id);
    if (!source) return;
    return loadModelSources([source], setState);
  }, [open, key, id]); // The selected summary model does not change this provider's catalog.
  if (!key) return null;
  const options = (state?.options ?? []).filter(choice => `${choice.label} ${choice.model}`.toLowerCase().includes(search.toLowerCase()));
  const visible = showAll ? options : options.slice(0, 8);
  const choose = async (choice: ModelChoice) => {
    setSaving(choice.model);
    try {
      const saved = await activateNotesModel({ ...choice.config, provider: id, model: choice.model });
      setModelConfig(saved);
    } catch (error) { toast.error('Couldn’t switch summary models', { description: String(error) }); }
    finally { setSaving(undefined); }
  };
  return <details className="tetro-external-catalog" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Browse summary models from {name}</summary>
    <div className="tetro-external-catalog-body">
      <Input type="search" aria-label={`Search ${name} summary models`} placeholder="Find a model by name" value={search} onChange={event => { setSearch(event.target.value); setShowAll(false); }} />
      {state?.status === 'loading' && <p className="tetro-setting-note">Checking the model catalog…</p>}
      {state?.status === 'error' && <p className="tetro-setting-note" role="alert">Couldn’t check {name} models. Close and reopen this list to retry.</p>}
      {state?.status === 'ready' && !options.length && <p className="tetro-setting-note">No matching summary models were returned.</p>}
      {visible.map(choice => {
        const selected = modelConfig.provider === id && modelConfig.model === choice.model;
        return <div className="tetro-external-model" key={choice.model}>
          <span><strong>{choice.label}</strong><small>{choice.model !== choice.label ? `${choice.model} · ` : ''}{choice.detail}</small></span>
          <button type="button" className="tetro-key" disabled={selected || !!saving} onClick={() => void choose(choice)}>{selected ? 'In use' : saving === choice.model ? 'Saving…' : 'Use'}</button>
        </div>;
      })}
      {!showAll && options.length > visible.length && <button type="button" className="tetro-link" onClick={() => setShowAll(true)}>Show all {options.length} models</button>}
      <p className="tetro-setting-note">Selecting a model sends transcript text to {name} when you create a summary or draft a template.</p>
    </div>
  </details>;
}
