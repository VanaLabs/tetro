'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { History } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { textUpdated } from '@/lib/meeting-edits';

type Version = { id: string; kind: string; label: string; created_at: string };
export function MeetingVersions({ meetingId, kind, onRestored, canRestore = true, open: controlledOpen, onOpenChange, hideTrigger = false, returnFocus }: { meetingId: string; kind: 'transcript' | 'summary'; onRestored?: () => void | Promise<void>; canRestore?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean; returnFocus?: () => void }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<Version | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setSelected(null); setError('');
    invoke<Version[]>('api_get_meeting_versions', { meetingId }).then(rows => { if (!cancelled) setVersions(rows.filter(v => v.kind === kind || v.kind === 'correction')); })
      .catch(e => { if (!cancelled) setError(String(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, meetingId, kind]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false; setPreview('Loading…'); setError('');
    invoke<string>('api_preview_meeting_version', { meetingId, versionId: selected.id, kind }).then(text => { if (!cancelled) setPreview(text || 'Empty in this version.'); }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [meetingId, selected, kind]);
  const restore = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await invoke('api_restore_meeting_version', { meetingId, versionId: selected.id });
      textUpdated(meetingId); await onRestored?.(); setOpen(false);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <>{!hideTrigger && <Button size="sm" variant="outline" title="Previous versions" aria-label={`Previous ${kind === 'summary' ? 'summary' : 'transcript'} versions`} onClick={() => setOpen(true)}><History size={16} /></Button>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="tetro-versions" onCloseAutoFocus={event => { if (returnFocus) { event.preventDefault(); returnFocus(); } }}>
      <DialogTitle>Previous {kind === 'summary' ? 'summaries' : 'transcripts'}</DialogTitle>
      <DialogDescription>Preview an earlier version before restoring it. Your current text is kept as another version. Audio and important moments stay in place.</DialogDescription>
      {error && <p role="alert">{error}</p>}
      {loading ? <p role="status">Loading versions…</p> : !versions.length ? <p>No previous versions yet. Tetro keeps one when you edit or try again.</p> : <div className="tetro-version-grid">
        <div className="tetro-version-list">{versions.map(v => <button key={v.id} aria-pressed={selected?.id === v.id} disabled={busy} onClick={() => setSelected(v)}><b>{v.label}</b><small>{new Date(v.created_at).toLocaleString()}</small></button>)}</div>
        <pre className="tetro-version-preview">{selected ? preview : 'Choose a version to preview it.'}</pre>
      </div>}
      {selected?.kind === 'correction' && <p>This correction changed both the transcript and summary. Restoring it brings both back.</p>}
      {!canRestore && <p>Save or cancel your current edits before restoring a version.</p>}
      <div className="tetro-dialog-actions"><button disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="tetro-key tetro-key-amber" disabled={!canRestore || !selected || busy || preview === 'Loading…'} onClick={() => void restore()}>{busy ? 'Restoring…' : 'Restore version'}</button></div>
    </DialogContent></Dialog></>;
}
