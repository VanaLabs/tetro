'use client';
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Copy, Download, FileText, Handshake, HeartHandshake, Lightbulb, MessagesSquare, MicVocal, Milestone, NotebookPen, Pencil, Plus, RefreshCw, RotateCcw, Route, Sunrise, Trash2, Upload, UsersRound, type LucideIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { TemplateEditor, type TemplateBody } from '@/components/tetro/TemplateEditor';
import { resetTemplateSuggestionCache } from '@/hooks/useTemplateSuggestion';
import { templateExample } from '@/lib/template-preview';
import { isEverydayTemplate, sortTemplates } from '@/lib/template-catalog';

type TemplateInfo = { id: string; name: string; description: string; is_custom?: boolean; has_original?: boolean };
type FullTemplate = { id: string; template: TemplateBody; is_custom: boolean; has_original: boolean };
type Editing = { id?: string; initial?: TemplateBody } | null;

const FORMAT_LABEL = { paragraph: 'Paragraph', list: 'Bullet list', string: 'One line' } as const;
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  standard_meeting: FileText,
  ideas_and_notes: Lightbulb,
  team_meeting: UsersRound,
  interview: MessagesSquare,
  daily_standup: Sunrise,
  plan: Route,
  project_sync: Milestone,
  retrospective: RotateCcw,
  sales_marketing_client_call: Handshake,
  podcast_pre_interview: MicVocal,
  psychatric_session: HeartHandshake,
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<FullTemplate | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const list = await invoke<TemplateInfo[]>('api_list_templates');
      setTemplates(list);
      setSelectedId(current => current && list.some(t => t.id === current) ? current : list.find(t => t.id === 'standard_meeting')?.id ?? list[0]?.id ?? null);
    }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let cancelled = false;
    invoke<FullTemplate>('api_get_template_full', { templateId: selectedId })
      .then(details => { if (!cancelled) setSelected(details); })
      .catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [selectedId, templates]);

  const onSaved = async (id: string) => {
    resetTemplateSuggestionCache();
    setEditing(null);
    await load();
    setSelectedId(id);
  };
  const importTemplate = async () => {
    try {
      const id = await invoke<string | null>('api_import_template');
      if (!id) return;
      resetTemplateSuggestionCache();
      await load(); setSelectedId(id);
    } catch (e) { toast.error('Couldn’t import the template', { description: String(e) }); }
  };
  const exportTemplate = async (id: string) => {
    try { await invoke<boolean>('api_export_template', { templateId: id }); }
    catch (e) { toast.error('Couldn’t export the template', { description: String(e) }); }
  };
  const removeSelected = async () => {
    if (!selected) return;
    try {
      await invoke('api_delete_custom_template', { templateId: selected.id });
      setConfirmDelete(false);
      if (!selected.has_original) setSelectedId(null);
      await load();
    } catch (e) { toast.error(String(e)); }
  };

  const visible = sortTemplates(templates
    .filter(t => `${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase())));
  const everyday = visible.filter(t => isEverydayTemplate(t.id));
  const more = visible.filter(t => !isEverydayTemplate(t.id));
  const templateButton = (t: TemplateInfo) => {
    const isUserMade = Boolean(t.is_custom && !t.has_original);
    const Icon = isUserMade ? NotebookPen : (TEMPLATE_ICONS[t.id] ?? FileText);
    return <button key={t.id} onClick={() => setSelectedId(t.id)} className={selectedId === t.id ? 'selected' : ''} aria-current={selectedId === t.id ? 'true' : undefined}>
      <span className={isUserMade ? 'tetro-template-icon tetro-template-icon-custom' : 'tetro-template-icon'}><Icon aria-hidden="true" focusable="false" strokeWidth={1.8} /></span>
      <span><strong>{t.name}{t.is_custom && <em className="tetro-tag">{t.has_original ? 'Customized' : 'Yours'}</em>}</strong><small>{t.description}</small></span>
    </button>;
  };

  return <section className="tetro-template-page">
    <div className="tetro-page-toolbar">
      <input aria-label="Search templates" placeholder="Search templates…" value={query} onChange={e => setQuery(e.target.value)} />
      <span>{templates.length} templates</span>
      <span className="tetro-spacer" />
      <button onClick={() => void load()} title="Refresh templates" aria-label="Refresh templates"><RefreshCw /></button>
      <button onClick={() => void importTemplate()} title="Add a template from a .json file"><Upload />Import</button>
      <button className="tetro-primary" onClick={() => setEditing({})}><Plus />New template</button>
    </div>
    {error && <p role="alert" className="tetro-editor-error tetro-page-error">{error}</p>}

    {editing ? <div className="tetro-template-columns"><article className="tetro-editor-sheet">
      <TemplateEditor key={editing.id ?? 'new'} templateId={editing.id} initial={editing.initial} onSaved={id => void onSaved(id)} onClose={() => setEditing(null)} />
    </article></div> : <div className="tetro-template-columns">
      <nav aria-label="Summary templates">
        {loading && <p className="tetro-muted">Loading templates…</p>}
        {!loading && everyday.length > 0 && <><p className="tetro-template-group-label">Everyday</p>{everyday.map(templateButton)}</>}
        {!loading && more.length > 0 && <><p className="tetro-template-group-label">More templates</p>{more.map(templateButton)}</>}
        {!loading && !visible.length && <p className="tetro-muted">No templates match “{query}”.</p>}
      </nav>
      <article>
        {selected ? <>
          <div className="tetro-template-head">
            <div><h2>{selected.template.name}</h2><p>{selected.template.description}</p></div>
            <div className="tetro-template-actions">
              {selected.is_custom
                ? <button className="tetro-key" onClick={() => setEditing({ id: selected.id, initial: selected.template })}><Pencil />Edit</button>
                : <button className="tetro-key" onClick={() => setEditing({ id: selected.id, initial: selected.template })} title="Change this template. You can restore the original later."><Pencil />Customize</button>}
              <button className="tetro-key" onClick={() => setEditing({ initial: { ...selected.template, name: `${selected.template.name} (copy)` } })}><Copy />Duplicate</button>
              <button className="tetro-key" onClick={() => void exportTemplate(selected.id)} title="Save as a .json file to share or back up"><Download />Export</button>
              {selected.is_custom && <button className="tetro-key" onClick={() => setConfirmDelete(true)}>{selected.has_original ? <><RotateCcw />Restore original</> : <><Trash2 />Delete</>}</button>}
            </div>
          </div>
          <h3>Example summaries</h3>
          <p className="tetro-muted">Fictional example content. Sections without relevant content are omitted. Check generated summaries against your recording.</p>
          <ol className="tetro-template-sections">
            {selected.template.sections.map((s, i) => <li key={`${s.title}-${i}`}>
              <b>{s.title}</b>
              {s.format === 'list' ? <ul>{templateExample(s, selected.id).map((line,i) => <li key={i}>{line}</li>)}</ul> : <p>{templateExample(s, selected.id)[0]}</p>}
            </li>)}
          </ol>
          <details className="tetro-template-instructions"><summary>Template instructions</summary>{selected.template.sections.map((s,i) => <p key={i}><b>{s.title}:</b> {s.instruction}</p>)}</details>
          <p className="tetro-muted">Choose this template from a meeting’s Summary toolbar when summarizing it.</p>
        </> : <div className="tetro-template-empty">
          <p>Pick a template to see what it writes, or make your own.</p>
          <button className="tetro-key tetro-key-amber" onClick={() => setEditing({})}><Plus />New template</button>
        </div>}
      </article>
    </div>}

    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent>
      <DialogTitle>{selected?.has_original ? 'Restore the original template?' : 'Delete this template?'}</DialogTitle>
      <DialogDescription>{selected?.has_original ? `Your changes to “${selected?.template.name}” will be removed.` : `“${selected?.template.name}” will be deleted. Meetings that already have a summary are not affected.`}</DialogDescription>
      <div className="tetro-dialog-actions"><button onClick={() => setConfirmDelete(false)}>Cancel</button><button className="tetro-danger" onClick={() => void removeSelected()}>{selected?.has_original ? 'Restore original' : 'Delete template'}</button></div>
    </DialogContent></Dialog>
  </section>;
}
