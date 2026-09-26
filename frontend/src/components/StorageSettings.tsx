'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { ChevronRight, FolderOpen, Trash2 } from 'lucide-react';
import { useConfirm } from '@/components/tetro/useConfirm';
import { shortPath } from '@/components/tetro/SettingRow';
import { getModelDisplayName } from '@/lib/parakeet';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

type Folder = { path: string; bytes: number; items: number };
type Summary = { recordings: Folder; models: Folder; database_bytes: number; meetings: number; summaries: number };
type Recording = { name: string; path: string; bytes: number; modified?: string | null; meeting_title?: string | null };
type Installed = { key: string; kind: 'Transcription' | 'Summary'; label: string; mb: number; remove: () => Promise<unknown> };
type Meeting = { id: string; title: string; created_at: string };

export const formatBytes = (bytes: number) => bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : bytes < 1e9 ? `${Math.round(bytes / 1e6)} MB` : `${(bytes / 1e9).toFixed(1)} GB`;
const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function installedModels(): Promise<Installed[]> {
  const out: Installed[] = [];
  for (const engine of ['whisper', 'parakeet'] as const) {
    try {
      await invoke(`${engine}_init`);
      const models = await invoke<{ name: string; size_mb: number; status: unknown }[]>(`${engine}_get_available_models`);
      models.filter(m => m.status === 'Available').forEach(m => out.push({
        key: `${engine}:${m.name}`, kind: 'Transcription', mb: m.size_mb,
        label: engine === 'parakeet' ? getModelDisplayName(m.name) : `Whisper ${m.name}`,
        remove: () => invoke(`${engine}_delete_corrupted_model`, { modelName: m.name }),
      }));
    } catch { /* engine unavailable */ }
  }
  try {
    const models = await invoke<{ name: string; display_name: string; size_mb: number; status: { type: string } }[]>('builtin_ai_list_models');
    models.filter(m => m.status?.type === 'available').forEach(m => out.push({
      key: `builtin:${m.name}`, kind: 'Summary', mb: m.size_mb, label: m.display_name || m.name,
      remove: () => invoke('builtin_ai_delete_model', { modelName: m.name }),
    }));
  } catch { /* none */ }
  return out;
}

/** A storage category: swatch, size and count; expands to list its items. */
function Section({ swatch, title, meta, open, onToggle, action, children }: { swatch: string; title: string; meta: string; open: boolean; onToggle: () => void; action?: ReactNode; children: ReactNode }) {
  return <section className={`tetro-store ${open ? 'is-open' : ''}`}>
    <div className="tetro-store-head">
      <button className="tetro-store-toggle" onClick={onToggle} aria-expanded={open}>
        <ChevronRight className="tetro-store-chev" aria-hidden="true" />
        <i className={`tetro-swatch ${swatch}`} aria-hidden="true" />
        <span className="tetro-store-title">{title}</span>
        <span className="tetro-store-meta">{meta}</span>
      </button>
      {action}
    </div>
    {open && <div className="tetro-store-list">{children}</div>}
  </section>;
}

function Item({ title, detail, onDelete, label = 'Delete' }: { title: ReactNode; detail: ReactNode; onDelete: () => void; label?: string }) {
  return <div className="tetro-store-item">
    <div><b>{title}</b><small>{detail}</small></div>
    <button className="tetro-model-remove" onClick={onDelete} title={label} aria-label={`${label}: ${typeof title === 'string' ? title : ''}`}><Trash2 /></button>
  </div>;
}

/** Settings → Storage: what Tetro keeps on disk, and a place to free space item by item. */
export function StorageSettings() {
  const { refetchMeetings } = useSidebar();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [models, setModels] = useState<Installed[] | null>(null);
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ models: true });
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    const [s, m, r, mt] = await Promise.all([
      invoke<Summary>('api_storage_summary').catch(() => null),
      installedModels(),
      invoke<Recording[]>('api_list_recordings').catch(() => []),
      invoke<Meeting[]>('api_get_meetings').catch(() => []),
    ]);
    setSummary(s); setModels(m); setRecordings(r); setMeetings(mt);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const run = async (ask: Parameters<typeof confirm>[0], action: () => Promise<unknown>) => {
    if (!await confirm(ask)) return;
    try { await action(); await load(); } catch (e) { toast.error('That didn’t work', { description: String(e) }); }
  };

  const total = summary ? summary.recordings.bytes + summary.models.bytes + summary.database_bytes : 0;
  const share = (bytes: number) => total ? `${Math.max(1.5, (bytes / total) * 100)}%` : '0%';

  return <div className="tetro-settings-stack">
    {dialog}
    <div className="tetro-storage-total">
      <b>{summary ? formatBytes(total) : '…'}</b><span>used by Tetro on this device</span>
      {summary && <div className="tetro-storage-bar" aria-hidden="true">
        <i style={{ width: share(summary.recordings.bytes) }} className="is-recordings" />
        <i style={{ width: share(summary.models.bytes) }} className="is-models" />
        <i style={{ width: share(summary.database_bytes) }} className="is-data" />
      </div>}
    </div>

    <div className="tetro-store-group">
      <Section swatch="is-recordings" title="Recordings" open={!!open.rec} onToggle={() => toggle('rec')}
        meta={summary ? `${formatBytes(summary.recordings.bytes)} · ${plural(recordings?.length ?? summary.recordings.items, 'recording')}` : '…'}
        action={<button className="tetro-key" onClick={() => void invoke('open_recordings_folder')} title={summary ? shortPath(summary.recordings.path) : undefined}><FolderOpen className="w-4 h-4" />Open</button>}>
        {!recordings?.length ? <p className="tetro-setting-note">No recordings saved.</p> : recordings.map(r =>
          <Item key={r.path} title={r.meeting_title ?? r.name} detail={`${formatBytes(r.bytes)} · ${day(r.modified)}${r.meeting_title ? '' : ' · not linked to a meeting'}`} label="Delete audio"
            onDelete={() => void run({ title: `Delete the audio for “${r.meeting_title ?? r.name}”?`, body: `This frees ${formatBytes(r.bytes)}. ${r.meeting_title ? 'The transcript and summary stay; playback won’t be possible.' : 'This folder isn’t linked to any meeting.'}`, confirm: 'Delete audio' },
              () => invoke('api_delete_recording', { path: r.path }))} />)}
      </Section>

      <Section swatch="is-models" title="Models" open={!!open.models} onToggle={() => toggle('models')}
        meta={summary ? `${formatBytes(summary.models.bytes)} · ${plural(models?.length ?? 0, 'model')}` : '…'}
        action={<button className="tetro-key" onClick={() => void invoke('open_models_folder')}><FolderOpen className="w-4 h-4" />Open</button>}>
        {models === null ? <p className="tetro-setting-note">Checking…</p> : !models.length ? <p className="tetro-setting-note">No models downloaded yet.</p> : models.map(m =>
          <Item key={m.key} title={m.label} detail={`${m.kind} · ${formatBytes(m.mb * 1e6)}`} label="Remove model"
            onDelete={() => void run({ title: `Remove ${m.label}?`, body: `This frees about ${formatBytes(m.mb * 1e6)}. You can download it again at any time.`, confirm: 'Remove model' }, m.remove)} />)}
      </Section>

      <Section swatch="is-data" title="Transcripts and summaries" open={!!open.data} onToggle={() => toggle('data')}
        meta={summary ? `${formatBytes(summary.database_bytes)} · ${plural(summary.meetings ?? meetings?.length ?? 0, 'meeting')}${summary.summaries !== undefined ? ` · ${plural(summary.summaries, 'summary', 'summaries')}` : ''}` : '…'}>
        {!meetings?.length ? <p className="tetro-setting-note">No meetings yet.</p> : meetings.map(m =>
          <Item key={m.id} title={m.title} detail={day(m.created_at)} label="Delete meeting"
            onDelete={() => void run({ title: `Delete “${m.title}”?`, body: 'Its transcript and summary will be deleted. This can’t be undone.', confirm: 'Delete meeting' },
              async () => { await invoke('api_delete_meeting', { meetingId: m.id }); await refetchMeetings(); })} />)}
      </Section>
    </div>
  </div>;
}
