'use client';
import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { updateService, type UpdateInfo } from '@/services/updateService';
import { type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';
import { useRecordingState } from '@/contexts/RecordingStateContext';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; updateInfo: UpdateInfo | null }
export function UpdateDialog({ open, onOpenChange, updateInfo }: Props) {
  const recording = useRecordingState();
  const blocked = recording.isRecording || recording.isStartingRecording || recording.isStopping || recording.isProcessing || recording.isSaving;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [downloadedUpdate, setDownloadedUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const ready = downloadedUpdate?.version === updateInfo?.version && !!downloadedUpdate;

  async function download() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setProgress(null);
    try {
      const update = updateService.getUpdate(updateInfo?.version);
      let total = 0, received = 0;
      await update.download(event => {
        if (event.event === 'Started') total = event.data.contentLength || 0;
        if (event.event === 'Progress') received += event.data.chunkLength;
        setProgress(total ? Math.min(100, Math.round(received / total * 100)) : null);
      });
      setDownloadedUpdate(update);
    } catch (e) { setError(String(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function install() {
    if (!downloadedUpdate || blocked || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError('');
    try {
      // Check native state too, including paused recordings, before replacing the app.
      if (await invoke<boolean>('is_recording')) throw new Error('Finish your recording before installing the update.');
      await downloadedUpdate.install();
      await relaunch();
    } catch (e) { setError(String(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  if (!updateInfo?.available) return null;
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{ready ? 'Ready to install' : 'Update available'}</DialogTitle>
        <DialogDescription>Tetro {updateInfo.version} · Installed version {updateInfo.currentVersion}</DialogDescription>
      </DialogHeader>
      {updateInfo.body && <p className="whitespace-pre-wrap max-h-48 overflow-auto">{updateInfo.body}</p>}
      {busy && <p role="status">{ready ? 'Installing and restarting…' : progress === null ? 'Downloading…' : `Downloading… ${progress}%`}</p>}
      {ready && <p>Finish any imports, summaries, and edits before restarting. Your saved meetings, settings, and downloaded models stay on this device.</p>}
      {blocked && <p role="status">Finish recording and let Tetro save before installing.</p>}
      {error && <p role="alert">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Later</Button>
        <Button disabled={busy || (ready && blocked)} onClick={() => void (ready ? install() : download())}>{ready ? 'Install and restart' : 'Download update'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
