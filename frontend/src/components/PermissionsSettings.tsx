'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SettingGroup, SettingRow } from './tetro/SettingRow';

type Access = 'not_requested' | 'granted' | 'denied' | 'restricted' | 'limited' | 'unknown';
type Snapshot = { platform: string; microphone: Access; notifications: Access };
const labels: Record<Access, string> = { not_requested: 'Not requested', granted: 'Allowed', denied: 'Not allowed', restricted: 'Restricted by macOS', limited: 'Limited access', unknown: 'Couldn’t check' };

export function PermissionsSettings({ onOpenModels }: { onOpenModels?: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  const [audio, setAudio] = useState<'unchecked' | 'verified' | 'inconclusive'>('unchecked');
  const [keys, setKeys] = useState<'unchecked' | 'available' | 'empty' | 'unavailable'>('unchecked');
  const mounted = useRef(true);
  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [permissions, capture] = await Promise.all([
        invoke<Snapshot>('get_app_permissions'),
        invoke<{ is_active: boolean }>('get_recording_state'),
      ]);
      if (mounted.current) { setSnapshot(permissions); setRecording(capture.is_active); }
    } catch {
      if (mounted.current) setError('Couldn’t read permissions. Try refreshing, or check System Settings.');
    } finally {
      refreshing.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => { setAudio('unchecked'); setKeys('unchecked'); void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { mounted.current = false; window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const run = async (id: string, work: () => Promise<void>) => {
    setPending(id); setError('');
    try { await work(); }
    catch (e) { if (mounted.current) setError(String(e)); }
    finally { if (mounted.current) setPending(undefined); }
  };
  const openSettings = (permission: string) => run(permission, async () => {
    await invoke('open_app_permission_settings', { permission });
  });
  const request = (permission: 'microphone' | 'notifications') => run(permission, async () => {
    const status = await invoke<Access>('request_app_permission', { permission });
    if (mounted.current) setSnapshot(previous => previous && { ...previous, [permission]: status });
    await refresh();
  });
  const nativeRow = (id: 'microphone' | 'notifications', name: string, hint: string) => {
    const access = snapshot?.[id];
    const canRequest = access === 'not_requested' || access === 'unknown';
    return <SettingRow label={<>{name}<span className="tetro-permission-status" role="status">{loading ? 'Checking…' : labels[access ?? 'unknown']}</span></>} hint={hint}>
      {canRequest && <button type="button" className="tetro-key" disabled={!!pending || loading} onClick={() => void request(id)}>{pending === id ? 'Waiting…' : 'Request access'}</button>}
      <button type="button" className="tetro-key" disabled={!!pending || loading} onClick={() => void openSettings(id)}>System Settings</button>
    </SettingRow>;
  };

  return <div className="tetro-settings-stack tetro-permissions">
    <div className="tetro-permissions-intro">
      <p>Check what Tetro can access and retry a permission when needed.</p>
      <button type="button" className="tetro-key" disabled={loading || !!pending} onClick={() => { setError(''); setAudio('unchecked'); setKeys('unchecked'); void refresh(); }}>Refresh status</button>
    </div>
    {snapshot && snapshot.platform !== 'macos' && <p className="tetro-setting-note">Permission checks are available on macOS. On this system, manage access in your operating system settings.</p>}
    <SettingGroup title="Recording">
      {nativeRow('microphone', 'Microphone', 'Records your voice. If access was denied, enable Tetro in Privacy & Security → Microphone.')}
      <SettingRow label={<>Computer audio<span className="tetro-permission-status" role="status">{pending === 'system_audio' ? 'Listening for audio…' : audio === 'verified' ? 'Audio received' : audio === 'inconclusive' ? 'Couldn’t verify' : 'Not checked'}</span></>} hint="Play some audio, then test. Tetro listens for up to six seconds and discards the samples. Silence can mean access is off or nothing is playing.">
        <button type="button" className="tetro-key" disabled={!!pending || recording || loading} onClick={() => void run('system_audio', async () => {
          const result = await invoke<string>('test_system_audio_access');
          if (mounted.current) setAudio(result === 'verified' ? 'verified' : 'inconclusive');
        })}>{pending === 'system_audio' ? 'Testing…' : 'Test access'}</button>
        <button type="button" className="tetro-key" disabled={!!pending || loading} onClick={() => void openSettings('system_audio')}>System Settings</button>
      </SettingRow>
    </SettingGroup>
    <p className="tetro-setting-note">Computer audio is listed under Privacy & Security → Audio Capture, or Screen & System Audio Recording, depending on your macOS version.{recording ? ' Finish your recording before running an audio test.' : ''}</p>
    <SettingGroup title="Optional access">
      {nativeRow('notifications', 'Notifications', 'Shows recording and meeting reminders. Your notification preferences are in General.')}
      <SettingRow label={<>Saved API keys<span className="tetro-permission-status" role="status">{pending === 'keychain' ? 'Waiting for Keychain…' : keys === 'available' ? 'Access confirmed' : keys === 'empty' ? 'Nothing to check yet' : keys === 'unavailable' ? 'Access unavailable' : 'Not checked'}</span></>} hint={keys === 'empty'
        ? 'No API keys are saved. Add a provider key in Models → External models, then return here to check Keychain access. Built-in models do not need an API key.'
        : 'Checks whether Tetro can read API keys you have saved in Models. Save a key first to use this check. macOS may ask for Keychain access; approval takes effect without restarting.'}>
        <button type="button" className="tetro-key" disabled={!!pending} onClick={() => void run('keychain', async () => {
          try {
            const count = await invoke<number>('check_saved_key_access');
            if (mounted.current) setKeys(count > 0 ? 'available' : 'empty');
            window.dispatchEvent(new Event('tetro:credentials-access-changed'));
          } catch (e) { if (mounted.current) setKeys('unavailable'); throw e; }
        })}>{pending === 'keychain' ? 'Checking…' : keys === 'unavailable' ? 'Retry access' : 'Check access'}</button>
        {keys === 'empty' && onOpenModels && <button type="button" className="tetro-key" disabled={!!pending} onClick={onOpenModels}>Open models</button>}
      </SettingRow>
    </SettingGroup>
    <p className="tetro-setting-note">If macOS asks you to quit and reopen Tetro after changing a recording permission, finish your recording first. Return here to refresh the status. Local models work without Keychain access.</p>
    {error && <p role="alert" className="tetro-permission-error">{error}</p>}
  </div>;
}
