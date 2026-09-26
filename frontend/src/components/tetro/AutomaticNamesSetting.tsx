'use client';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { SettingRow } from './SettingRow';

export function AutomaticNamesSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = () => { setError(''); void invoke<boolean>('api_get_automatic_names').then(setEnabled).catch(() => setError('Couldn’t load this setting.')); };
  useEffect(load, []);
  const change = async (next: boolean) => {
    setSaving(true);
    try { await invoke('api_set_automatic_names', { enabled: next }); setEnabled(next); }
    catch (e) { toast.error('Couldn’t save automatic naming', { description: String(e) }); }
    finally { setSaving(false); }
  };
  return <SettingRow label="Name recordings automatically" hint={error ? <>{error} <button className="tetro-link" onClick={load}>Retry</button></> : 'Name new recordings after transcription, even when automatic summaries are off. Uses your summary model when available. Names you type always stay.'}>
    <Switch checked={enabled ?? false} disabled={enabled === null || saving} onCheckedChange={next => void change(next)} aria-label="Name recordings automatically" />
  </SettingRow>;
}
