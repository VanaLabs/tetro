'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { SettingGroup, SettingRow } from '@/components/tetro/SettingRow';
import { Switch } from '@/components/ui/switch';

type Shortcuts = { toggle_recording: string; mark_moment: string };
const SYMBOL: Record<string, string> = { Super: '⌘', Command: '⌘', Cmd: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' };

/** "Alt+Super+R" → "⌥⌘R" */
export const prettyShortcut = (s: string) => s.split('+').map(p => SYMBOL[p] ?? (p.startsWith('Key') ? p.slice(3) : p.startsWith('Digit') ? p.slice(5) : p)).join('');

/** Turns a key press into the plugin's shortcut syntax; null until a non-modifier key is pressed with ⌘/⌃/⌥. */
function fromEvent(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[];
  if (!mods.some(m => m !== 'Shift')) return null;
  const code = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code;
  return [...mods, code].join('+');
}

function ShortcutField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setListening(false); return; }
      const next = fromEvent(e);
      if (next) { setListening(false); onChange(next); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, onChange]);
  return <>
    <kbd className={`tetro-kbd ${listening ? 'is-listening' : ''}`} aria-live="polite">{listening ? 'Press keys…' : prettyShortcut(value)}</kbd>
    <button className="tetro-key" onClick={() => setListening(l => !l)} aria-label={`Change shortcut for ${label}`}>{listening ? 'Cancel' : 'Change'}</button>
  </>;
}

/** Settings → Recordings → Shortcuts. They work while Tetro is in the background. */
export function ShortcutSettings() {
  const [shortcuts, setShortcuts] = useState<Shortcuts | null>(null);
  useEffect(() => { invoke<Shortcuts>('api_get_shortcuts').then(setShortcuts).catch(() => setShortcuts({ toggle_recording: 'Alt+Super+R', mark_moment: 'Alt+Super+M' })); }, []);
  const save = async (next: Shortcuts) => {
    try { setShortcuts(await invoke<Shortcuts>('api_set_shortcuts', { shortcuts: next })); }
    catch (e) { toast.error('Couldn’t use that shortcut', { description: String(e) }); }
  };
  const [callDetection, setCallDetection] = useState(true);
  useEffect(() => { invoke<boolean>('api_get_call_detection').then(setCallDetection).catch(() => {}); }, []);
  const toggleCallDetection = async (on: boolean) => {
    setCallDetection(on);
    try { await invoke('api_set_call_detection', { enabled: on }); } catch (e) { setCallDetection(!on); toast.error(String(e)); }
  };
  if (!shortcuts) return null;
  return <SettingGroup title="Calls and shortcuts">
    <SettingRow label="Notice calls" hint="When another app turns the microphone on, Tetro shows a dot by the menu-bar T and one quiet notification.">
      <Switch checked={callDetection} onCheckedChange={v => void toggleCallDetection(v)} aria-label="Notice calls" />
    </SettingRow>
    <SettingRow label="Start or stop recording" hint="Tetro stays in the background, so your call keeps focus.">
      <ShortcutField label="start or stop recording" value={shortcuts.toggle_recording} onChange={v => void save({ ...shortcuts, toggle_recording: v })} />
    </SettingRow>
    <SettingRow label="Mark a moment" hint="Flags the last 30 seconds as important. The summary will cover it.">
      <ShortcutField label="mark a moment" value={shortcuts.mark_moment} onChange={v => void save({ ...shortcuts, mark_moment: v })} />
    </SettingRow>
  </SettingGroup>;
}
