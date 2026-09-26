'use client';
import { correctName } from '@/lib/meeting-edits';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { Users } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

/** Toolbar control: label who is speaking (Beta), with a hint to steer the model. */
export function SpeakersButton({ meetingId, hasLabels, onDone }: { meetingId: string; hasLabels: boolean; onDone: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    const off = listen<{ meetingId: string; done: number; total: number }>('speaker-progress', e => { if (e.payload.meetingId === meetingId) setProgress(e.payload); });
    return () => { void off.then(fn => fn()); };
  }, [meetingId]);

  const run = async () => {
    setProgress({ done: 0, total: 1 });
    try {
      await invoke<number>('api_identify_speakers', { meetingId, hint });
      setOpen(false);
      await onDone();
    } catch (e) { toast.error('Couldn’t label speakers', { description: String(e) }); }
    finally { setProgress(null); }
  };
  const clear = async () => {
    try { await invoke('api_clear_speakers', { meetingId }); setOpen(false); await onDone(); } catch (e) { toast.error(String(e)); }
  };

  return <Popover open={open} onOpenChange={o => !progress && setOpen(o)}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" title="Label who is speaking (Beta)" aria-label="Speakers"><Users /><span className="hidden @[30rem]:inline">Speakers</span></Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="tetro-instructions">
      <label htmlFor="tetro-speaker-hint">Who was in this meeting? <span className="tetro-tag">Beta</span></label>
      <textarea id="tetro-speaker-hint" rows={3} value={hint} onChange={e => setHint(e.target.value)} disabled={!!progress}
        placeholder="Optional. e.g. Aram runs the meeting, Ana is the client, Sam joins at the end." />
      <p>Your summary model reads the transcript and labels each line. It can get people wrong; add a hint and run it again, or rename a speaker by clicking their name.</p>
      {progress && <div className="tetro-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><i style={{ width: `${Math.max(4, (progress.done / progress.total) * 100)}%` }} /></div>}
      <div className="tetro-dialog-actions">
        {hasLabels && <button onClick={() => void clear()} disabled={!!progress}>Remove labels</button>}
        <button className="tetro-primary" onClick={() => void run()} disabled={!!progress}>{progress ? `Labelling… ${progress.done}/${progress.total}` : hasLabels ? 'Label again' : 'Label speakers'}</button>
      </div>
    </PopoverContent>
  </Popover>;
}

/** Name shown above a line where the speaker changes; click to rename everywhere. */
export function SpeakerTag({ name, meetingId, onRenamed }: { name: string; meetingId: string; onRenamed: () => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const save = async () => {
    setEditing(false);
    const next = value.trim();
    if (!next || next === name) { setValue(name); return; }
    try { await invoke('api_rename_speaker', { meetingId, from: name, to: next }); await correctName(meetingId, name, next); await onRenamed(); }
    catch (e) { toast.error('Couldn’t rename the speaker', { description: String(e) }); setValue(name); }
  };
  return <div className="tetro-speaker" style={{ ['--hue' as string]: hue }}>
    {editing
      ? <input autoFocus value={value} onChange={e => setValue(e.target.value)} onBlur={() => void save()} aria-label={`Rename ${name}`}
          onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { setValue(name); setEditing(false); } }} />
      : <button onClick={() => setEditing(true)} title="Rename this speaker everywhere"><i aria-hidden="true" />{name}</button>}
  </div>;
}
