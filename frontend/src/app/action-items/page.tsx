'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'next/navigation';
import { Check, Pencil, RefreshCw } from 'lucide-react';
import { Segmented } from '@/components/tetro/SettingRow';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type Item = { owner?: string | null; due?: string | null; key: string; meeting_id: string; meeting_title: string; created_at: string; text: string; done: boolean; source_latest: boolean };
type Filter = 'open' | 'done' | 'all';

export default function ActionItemsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState('');
  const [dueFilter, setDueFilter] = useState('all');
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<Item | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    try { const data = await invoke<Item[]>('api_list_action_items'); setItems(data); setError(''); }
    catch (e) { setError(`Your tasks could not be loaded. ${String(e)}`); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (item: Item) => {
    if (pending.has(item.key)) return;
    setPending(set => new Set(set).add(item.key));
    try {
      await invoke('api_set_action_item_done', { key: item.key, meetingId: item.meeting_id, done: !item.done });
      setItems(list => list?.map(i => i.key === item.key ? { ...i, done: !i.done } : i) ?? null);
      setError('');
    } catch (e) { setError(`This change was not saved. ${String(e)}`); }
    finally { setPending(set => { const next = new Set(set); next.delete(item.key); return next; }); }
  };
  const save = async () => {
    if (!edit?.text.trim()) return;
    setSaving(true);
    try {
      await invoke('api_edit_action_item', { key: edit.key, meetingId: edit.meeting_id, text: edit.text, owner: edit.owner || null, due: edit.due || null });
      setItems(list => list?.map(i => i.key === edit.key ? edit : i) ?? null); setEdit(null); setError('');
    } catch (e) { setError(`This task was not saved. ${String(e)}`); }
    finally { setSaving(false); }
  };

  const owners = useMemo(() => [...new Set((items ?? []).map(i => i.owner).filter((s): s is string => !!s))].sort(), [items]);
  const groups = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const shown = (items ?? []).filter(i => {
      if (filter !== 'all' && (filter === 'done') !== i.done) return false;
      if (person === '__unassigned' ? !!i.owner : person && i.owner !== person) return false;
      if (!`${i.text} ${i.meeting_title} ${i.owner ?? ''} ${i.due ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return false;
      if (dueFilter === 'dated' && !i.due || dueFilter === 'undated' && i.due) return false;
      if (dueFilter === 'overdue') {
        // Relative wording such as “Friday” is kept as written, never guessed.
        if (i.done || !i.due || !/^\d{4}-\d{2}-\d{2}$/.test(i.due)) return false;
        return new Date(`${i.due}T00:00:00`).getTime() < today.getTime();
      }
      return true;
    });
    const map = new Map<string, { title: string; created_at: string; items: Item[] }>();
    for (const i of shown) {
      if (!map.has(i.meeting_id)) map.set(i.meeting_id, { title: i.meeting_title, created_at: i.created_at, items: [] });
      map.get(i.meeting_id)!.items.push(i);
    }
    return [...map.entries()];
  }, [items, filter, query, person, dueFilter]);
  const openCount = items?.filter(i => !i.done).length ?? 0;
  const narrowed = !!query || !!person || dueFilter !== 'all';

  return <section className="tetro-template-page">
    <div className="tetro-page-toolbar tetro-task-filters">
      <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'open', label: `Open${items ? ` · ${openCount}` : ''}` }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} />
      <input aria-label="Search tasks" placeholder="Search tasks…" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Person" value={person} onChange={e => setPerson(e.target.value)}><option value="">Anyone</option><option value="__unassigned">Unassigned</option>{owners.map(p => <option key={p}>{p}</option>)}</select>
      <select aria-label="Due date" value={dueFilter} onChange={e => setDueFilter(e.target.value)}><option value="all">Any date</option><option value="dated">Has a due date</option><option value="overdue">Overdue</option><option value="undated">No due date</option></select>
      <button onClick={() => void load()} aria-label="Refresh tasks" title="Refresh tasks"><RefreshCw /></button>
    </div>
    {error && <p className="tetro-editor-error tetro-page-error" role="alert">{error} <button className="tetro-link" onClick={() => void load()}>Retry</button></p>}
    <div className="tetro-template-columns"><article className="tetro-actions">
      {items === null ? <p className="tetro-muted">{error ? 'Your existing tasks are still saved.' : 'Collecting action items…'}</p>
        : !groups.length ? <div className="tetro-template-empty"><p>{narrowed ? 'No tasks match these filters.' : filter === 'open' ? (items.length ? 'Everything is done.' : 'No action items yet. They appear here after Tetro writes your summary.') : 'Nothing here yet.'}</p>{narrowed && <button className="tetro-link" onClick={() => { setQuery(''); setPerson(''); setDueFilter('all'); }}>Clear filters</button>}</div>
        : groups.map(([id, g]) => <section key={id} className="tetro-actions-group">
          <header><button className="tetro-actions-meeting" onClick={() => router.push(`/meeting-details?id=${encodeURIComponent(id)}`)}>{g.title}</button><time>{new Date(g.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time></header>
          <ul>{g.items.map(i => <li key={i.key} data-done={i.done || undefined}>
            <button role="checkbox" aria-checked={i.done} disabled={pending.has(i.key)} className="tetro-check" onClick={() => void toggle(i)} aria-label={i.done ? `Mark “${i.text}” as open` : `Mark “${i.text}” as done`}>{i.done && <Check />}</button>
            <span>{i.text}{i.owner && <em className="tetro-tag">{i.owner}</em>}{i.due && <em className="tetro-tag">Due {i.due}</em>}{!i.source_latest && <em className="tetro-tag" title="Kept from an earlier version of this summary">Earlier summary</em>}</span>
            <button className="tetro-icon" title="Edit task" aria-label={`Edit task: ${i.text}`} onClick={() => setEdit({ ...i })}><Pencil /></button>
          </li>)}</ul>
        </section>)}
    </article></div>
    {edit && <Dialog open onOpenChange={open => { if (!open && !saving) setEdit(null); }}><DialogContent>
      <DialogTitle>Edit task</DialogTitle><DialogDescription>Changes stay with this task when the summary is generated again.</DialogDescription>
      {edit && <><label className="tetro-field"><span>Task</span><textarea value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} /></label>
        <label className="tetro-field"><span>Person (optional)</span><input value={edit.owner ?? ''} onChange={e => setEdit({ ...edit, owner: e.target.value })} /></label>
        <label className="tetro-field"><span>Due date (optional)</span><input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(edit.due ?? '') ? edit.due! : ''} onChange={e => setEdit({ ...edit, due: e.target.value })} />{edit.due && !/^\d{4}-\d{2}-\d{2}$/.test(edit.due) && <small>Currently: {edit.due}. Choose a date to include it in the Overdue filter.</small>}</label></>}
      {error && <p role="alert" className="tetro-editor-error">{error}</p>}
      <div className="tetro-dialog-actions"><button disabled={saving} onClick={() => setEdit(null)}>Cancel</button><button className="tetro-key tetro-key-amber" disabled={saving || !edit?.text.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save task'}</button></div>
    </DialogContent></Dialog>}
  </section>;
}
