'use client';
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { textUpdated, TRASH_UPDATED } from '@/lib/meeting-edits';

type Item = { id: string; meeting_id: string; title: string; created_at: string; parts: { transcript: boolean; summary: boolean; audio: boolean } };
const label = (item: Item) => Object.values(item.parts).every(Boolean) ? 'Entire meeting' : [item.parts.transcript && 'Transcript', item.parts.summary && 'Summary', item.parts.audio && 'Audio'].filter(Boolean).join(', ');

export default function TrashPage() {
  const { refetchMeetings } = useSidebar();
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<Item | null>(null);
  const load = useCallback(async () => {
    try { setItems(await invoke<Item[]>('api_list_trash')); setError(''); }
    catch (e) { setError(`Trash could not be opened. ${String(e)}`); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener(TRASH_UPDATED, refresh);
    return () => window.removeEventListener(TRASH_UPDATED, refresh);
  }, [load]);
  const restore = async (item: Item) => {
    setBusy(true); setError('');
    try { await invoke('api_restore_trash', { id: item.id }); textUpdated(item.meeting_id, undefined, true); await refetchMeetings(); await load(); }
    catch (e) { setError(`Could not restore this item. ${String(e)}`); } finally { setBusy(false); }
  };
  const permanentlyRemove = async () => {
    if (!remove) return;
    setBusy(true); setError('');
    try { await invoke('api_delete_trash_permanently', { id: remove.id }); setRemove(null); await refetchMeetings(); await load(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <section className="tetro-template-page">
    <div className="tetro-page-toolbar"><span>Items stay on this device until you restore or permanently delete them.</span></div>
    {error && <p role="alert" className="tetro-editor-error tetro-page-error">{error} <button className="tetro-link" onClick={() => void load()}>Try again</button></p>}
    <div className="tetro-template-columns"><article className="tetro-trash-list">
      {items === null ? <p>Loading Trash…</p> : !items.length ? <div className="tetro-template-empty"><p>Trash is empty.</p><small>Meetings and items you remove will appear here.</small></div> : items.map(item => <div key={item.id} className="tetro-trash-item">
        <div><strong>{item.title}</strong><small>{label(item)} · {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small></div>
        <button className="tetro-key" disabled={busy} onClick={() => void restore(item)}><RotateCcw />Restore</button>
        <button className="tetro-key tetro-key-square" disabled={busy} title="Delete permanently" aria-label={`Permanently delete ${label(item).toLowerCase()} from ${item.title}`} onClick={() => setRemove(item)}><Trash2 /></button>
      </div>)}
    </article></div>
    <Dialog open={!!remove} onOpenChange={open => { if (!open && !busy) setRemove(null); }}><DialogContent>
      <DialogTitle>Delete permanently?</DialogTitle><DialogDescription>{remove ? `${label(remove)} from “${remove.title}” will no longer be restorable from Trash.${remove.parts.audio ? ' Its recording file will be removed from this device.' : ''}` : ''}</DialogDescription>
      {error && <p role="alert" className="tetro-editor-error">{error}</p>}
      <div className="tetro-dialog-actions"><button disabled={busy} onClick={() => setRemove(null)}>Cancel</button><button className="tetro-danger" disabled={busy} onClick={() => void permanentlyRemove()}>{busy ? 'Deleting…' : 'Delete permanently'}</button></div>
    </DialogContent></Dialog>
  </section>;
}
