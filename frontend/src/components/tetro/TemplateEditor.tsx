'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { templateExample } from '@/lib/template-preview';

export type SectionFormat = 'paragraph' | 'list' | 'string';
export type TemplateSection = { title: string; instruction: string; format: SectionFormat; item_format?: string; example_item_format?: string };
export type TemplateBody = { name: string; description: string; sections: TemplateSection[] };

type Props = {
  /** Existing template id when editing; undefined for a new template. */
  templateId?: string;
  initial?: TemplateBody;
  onSaved: (id: string) => void;
  onClose: () => void;
};

const FORMATS: { value: SectionFormat; label: string; hint: string }[] = [
  { value: 'paragraph', label: 'Paragraph', hint: 'A few sentences' },
  { value: 'list', label: 'Bullet list', hint: 'Separate points' },
  { value: 'string', label: 'One line', hint: 'A date, name or decision' },
];

const EXAMPLES = [
  'Weekly check-in with my team. Start with wins, then problems, then who does what before next week.',
  'First call with a new client. I need their goals, budget, deadlines, concerns and the next steps we agreed.',
  'Job interview. Capture the candidate’s background, strengths, concerns and my overall impression.',
  '1:1 with my manager. Topics we discussed, feedback I got, and what I committed to.',
];

const BUILT_IN_PROVIDERS = new Set(['builtin-ai', 'local-llama', 'localllama']);
// Ollama counts as local only when it runs on this machine (the default endpoint).
const isLocalModel = (provider: string, endpoint?: string | null) => BUILT_IN_PROVIDERS.has(provider) || (provider === 'ollama' && (!endpoint || /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(endpoint)));
const PROVIDER_NAMES: Record<string, string> = { openai: 'OpenAI', claude: 'Anthropic', groq: 'Groq', openrouter: 'OpenRouter', 'custom-openai': 'your custom AI endpoint', ollama: 'Ollama' };

const emptySection = (): TemplateSection => ({ title: '', instruction: '', format: 'paragraph' });

export function TemplateEditor({ templateId, initial, onSaved, onClose }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<'describe' | 'edit'>(initial ? 'edit' : 'describe');
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<TemplateBody>(initial ?? { name: '', description: '', sections: [emptySection()] });
  const [drafting, setDrafting] = useState(false);
  const [draftedWith, setDraftedWith] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [model, setModel] = useState<{ provider: string; model: string; ollamaEndpoint?: string | null } | null | undefined>(undefined);
  const request = useRef(0);
  const draftJob = useRef<string | null>(null);
  const stopRequested = useRef(false);
  const [stopping, setStopping] = useState(false);
  useEffect(() => () => { if (draftJob.current) void invoke('api_cancel_template_draft', { requestId: draftJob.current }); }, []);
  const root = useRef<HTMLDivElement>(null);
  const baseline = useRef(JSON.stringify(initial ?? { name: '', description: '', sections: [emptySection()] }));
  const draftKey = `tetro.templateDraft.${templateId ?? (initial ? `copy-${encodeURIComponent(initial.name)}` : 'new')}`;
  const [draftReady, setDraftReady] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const dirty = JSON.stringify(draft) !== baseline.current || brief.trim().length > 0;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.draft?.sections && Array.isArray(saved.draft.sections)) {
          setDraft(saved.draft); setBrief(saved.brief ?? ''); setStep(saved.step === 'edit' ? 'edit' : 'describe'); setDraftedWith(saved.draftedWith ?? ''); setRecovered(true);
        }
      }
    } catch { setDraftStorageError(true); }
    setDraftReady(true);
  }, [draftKey]);
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (dirty) localStorage.setItem(draftKey, JSON.stringify({ draft, brief, step, draftedWith }));
      else localStorage.removeItem(draftKey);
      setDraftStorageError(false);
    } catch { setDraftStorageError(true); }
  }, [draftReady, draftKey, dirty, draft, brief, step, draftedWith]);

  useEffect(() => {
    invoke<{ provider?: string; model?: string; ollamaEndpoint?: string | null } | null>('api_get_model_config')
      .then(config => setModel(config?.provider && config?.model ? { provider: config.provider, model: config.model, ollamaEndpoint: config.ollamaEndpoint } : null))
      .catch(() => setModel(null));
  }, []);

  const isLocal = model ? isLocalModel(model.provider.toLowerCase(), model.ollamaEndpoint) : false;
  const modelNote = model === undefined ? 'Checking your summary model…'
    : model === null ? 'No summary model is set up yet.'
    : isLocal ? `Tetro will draft this with ${model.model} on this device. Your description stays here.`
    : `Tetro will draft this with ${model.model}. Your description is sent to ${PROVIDER_NAMES[model.provider.toLowerCase()] ?? model.provider}.`;

  const draftTemplate = async () => {
    const id = ++request.current;
    const requestId = crypto.randomUUID();
    draftJob.current = requestId; stopRequested.current = false;
    setStopping(false); setDrafting(true); setError('');
    try {
      const result = await invoke<{ template: TemplateBody; model_label: string }>('api_draft_template', { description: brief, requestId });
      if (id !== request.current || stopRequested.current) return;
      setDraft({ ...result.template, sections: result.template.sections.map(s => ({ ...s, format: (FORMATS.some(f => f.value === s.format) ? s.format : 'paragraph') as SectionFormat })) });
      setDraftedWith(result.model_label);
      setStep('edit');
    } catch (e) {
      if (id === request.current && !stopRequested.current) setError(String(e));
    } finally {
      if (id === request.current) { setDrafting(false); setStopping(false); draftJob.current = null; }
    }
  };
  const stopDrafting = async () => {
    if (!draftJob.current) return;
    stopRequested.current = true; setStopping(true);
    try { await invoke('api_cancel_template_draft', { requestId: draftJob.current }); }
    catch (e) { stopRequested.current = false; setStopping(false); setError(String(e)); }
  };

  const update = (patch: Partial<TemplateBody>) => setDraft(d => ({ ...d, ...patch }));
  const updateSection = (i: number, patch: Partial<TemplateSection>) => setDraft(d => ({ ...d, sections: d.sections.map((s, j) => j === i ? { ...s, ...patch } : s) }));
  const moveSection = (i: number, by: number) => setDraft(d => {
    const sections = [...d.sections]; const [s] = sections.splice(i, 1); sections.splice(i + by, 0, s); return { ...d, sections };
  });
  const removeSection = (i: number) => setDraft(d => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }));
  const addSection = () => setDraft(d => ({ ...d, sections: [...d.sections, emptySection()] }));

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!draft.name.trim()) list.push('Give the template a name.');
    if (!draft.description.trim()) list.push('Say in a few words what the template is for.');
    if (!draft.sections.length) list.push('Add at least one section.');
    draft.sections.forEach((s, i) => {
      if (!s.title.trim()) list.push(`Section ${i + 1} needs a title.`);
      if (!s.instruction.trim()) list.push(`Section ${i + 1} needs a note about what to write.`);
    });
    return list;
  }, [draft]);

  const save = async () => {
    if (problems.length) {
      setShowErrors(true);
      // Take the person straight to the first field that needs attention.
      requestAnimationFrame(() => {
        const field = root.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        field?.focus({ preventScroll: true });
      });
      return;
    }
    setSaving(true); setError('');
    try {
      const id = await invoke<string>('api_save_custom_template', { templateId: templateId ?? null, template: draft });
      baseline.current = JSON.stringify(draft);
      localStorage.removeItem(draftKey); setDraftReady(false);
      onSaved(id);
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  const requestClose = () => {
    if (dirty && draftStorageError) setConfirmDiscard(true);
    else onClose();
  };

  return <div ref={root} className="tetro-template-editor">
    <header className="tetro-editor-head">
      <div>
        <h2>{templateId ? 'Edit template' : 'New template'}</h2>
        <p>{step === 'describe' ? 'Describe the meeting and Tetro drafts a template you can change.' : 'Change anything you like. Save template when it’s ready to use.'}</p>
      </div>
      <button className="tetro-icon" onClick={requestClose} aria-label="Close editor" title="Close"><X /></button>
    </header>
    {draftStorageError ? <p role="alert" className="tetro-editor-error">This draft could not be kept automatically. Save the template before leaving.</p> : dirty && <p className="tetro-muted tetro-draft-note" role="status">{recovered ? 'Your unfinished draft is here.' : 'Draft kept on this device. You can close this and come back.'}</p>}

    {step === 'describe' ? <div className="tetro-editor-body tetro-describe">
      <label htmlFor="tetro-brief">What kind of meeting is this for?</label>
      <textarea id="tetro-brief" value={brief} onChange={e => setBrief(e.target.value)} rows={5} autoFocus disabled={drafting}
        placeholder="Describe the meeting and what you want in the summary. You can list the sections you want, in order." />
      <div className="tetro-examples" aria-label="Examples">
        <span>Try an example:</span>
        {EXAMPLES.map(example => <button key={example} type="button" onClick={() => setBrief(example)} disabled={drafting}>{example.split('.')[0]}</button>)}
      </div>
      <p className={`tetro-model-note ${isLocal ? 'is-local' : ''}`}><i aria-hidden="true" />{modelNote}{model === null && <> <button type="button" className="tetro-link" onClick={() => { sessionStorage.setItem('tetro.settingsTab', 'summaryModels'); router.push('/settings'); }}>Open summary settings</button></>}</p>
      {error && <p role="alert" className="tetro-editor-error">{error}</p>}
      <div className="tetro-editor-actions">
        <button type="button" className="tetro-key" onClick={() => { setStep('edit'); setError(''); }} disabled={drafting}>Start from scratch</button>
        {drafting
          ? <><span className="tetro-drafting" role="status"><i aria-hidden="true" />Drafting… a local model can take up to a minute.</span><button type="button" className="tetro-key" disabled={stopping} onClick={() => void stopDrafting()}>{stopping ? 'Stopping…' : 'Stop'}</button></>
          : <button type="button" className="tetro-key tetro-key-amber" onClick={() => void draftTemplate()} disabled={!model || brief.trim().length < 10}><Sparkles />Draft template</button>}
      </div>
    </div> : <div className="tetro-editor-body">
      {draftedWith && <p className="tetro-model-note is-local"><i aria-hidden="true" />Drafted by {draftedWith}. Read it through and change anything that doesn’t fit.</p>}
      <div className="tetro-editor-grid">
        <div className="tetro-editor-form">
          <label className="tetro-field"><span>Name</span><input value={draft.name} onChange={e => update({ name: e.target.value })} placeholder="e.g. Client check-in" aria-invalid={showErrors && !draft.name.trim()} /></label>
          <label className="tetro-field"><span>What it’s for</span><input value={draft.description} onChange={e => update({ description: e.target.value })} placeholder="e.g. Notes for weekly calls with clients" aria-invalid={showErrors && !draft.description.trim()} /></label>

          <h3>Sections <small>in the order they appear in the summary</small></h3>
          <ol className="tetro-section-list">
            {draft.sections.map((section, i) => <li key={i} className="tetro-section-card">
              <div className="tetro-section-top">
                <span className="tetro-section-num">{i + 1}</span>
                <input aria-label={`Section ${i + 1} title`} value={section.title} onChange={e => updateSection(i, { title: e.target.value })} placeholder="Section title, e.g. Decisions" aria-invalid={showErrors && !section.title.trim()} />
                <div className="tetro-section-tools">
                  <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0} aria-label={`Move section ${i + 1} up`} title="Move up"><ArrowUp /></button>
                  <button type="button" onClick={() => moveSection(i, 1)} disabled={i === draft.sections.length - 1} aria-label={`Move section ${i + 1} down`} title="Move down"><ArrowDown /></button>
                  <button type="button" onClick={() => removeSection(i)} disabled={draft.sections.length === 1} aria-label={`Remove section ${i + 1}`} title="Remove section"><Trash2 /></button>
                </div>
              </div>
              <label className="tetro-field"><span>What should Tetro write here?</span>
                <textarea rows={2} value={section.instruction} onChange={e => updateSection(i, { instruction: e.target.value })} placeholder="e.g. Every decision the group made, with who made it" aria-invalid={showErrors && !section.instruction.trim()} />
              </label>
              <div className="tetro-format" role="radiogroup" aria-label={`Section ${i + 1} layout`}>
                {FORMATS.map(f => <button key={f.value} type="button" role="radio" aria-checked={section.format === f.value} onClick={() => updateSection(i, { format: f.value })} title={f.hint}>{f.label}</button>)}
              </div>
            </li>)}
          </ol>
          <button type="button" className="tetro-key tetro-add-section" onClick={addSection}><Plus />Add section</button>
        </div>

        <aside className="tetro-editor-preview" aria-label="Preview">
          <span className="tetro-preview-label">Example layout · fictional content</span>
          <div className="tetro-preview-page">
            <b className="tetro-preview-title">{draft.name.trim() || 'Meeting title'}</b>
            {draft.sections.map((s, i) => <div key={i} className="tetro-preview-section">
              <b>{s.title.trim() || `Section ${i + 1}`}</b>
              {s.format === 'list' ? <ul>{templateExample(s).map((line,i) => <li key={i}>{line}</li>)}</ul> : <p>{templateExample(s)[0]}</p>}
            </div>)}
          </div>
        </aside>
      </div>

      {showErrors && problems.length > 0 && <ul role="alert" className="tetro-editor-error">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      {error && <p role="alert" className="tetro-editor-error">{error}</p>}
      <div className="tetro-editor-actions is-sticky">
        {!templateId && <button type="button" className="tetro-key" onClick={() => { setStep('describe'); setDraftedWith(''); }}>Back to description</button>}
        <span className="tetro-spacer" />
        <button type="button" className="tetro-key" onClick={requestClose}>Close</button>
        <button type="button" className="tetro-key tetro-key-amber" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save template'}</button>
      </div>
    </div>}

    <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}><DialogContent>
      <DialogTitle>Discard this template?</DialogTitle>
      <DialogDescription>Tetro couldn’t keep this draft. Closing now will lose your changes.</DialogDescription>
      <div className="tetro-dialog-actions"><button onClick={() => setConfirmDiscard(false)}>Keep editing</button><button className="tetro-danger" onClick={() => { setConfirmDiscard(false); onClose(); }}>Discard</button></div>
    </DialogContent></Dialog>
  </div>;
}
