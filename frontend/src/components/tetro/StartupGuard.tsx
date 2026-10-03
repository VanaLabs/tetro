'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TetroStartupScreen } from './TetroStartupScreen';
export function StartupGuard({ children }: { children: ReactNode }) {
  const [issue, setIssue] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { invoke<string | null>('api_startup_issue').then(setIssue).catch(e => setIssue(String(e))); }, []);
  const retry = async () => { setBusy(true); try { await invoke('api_retry_startup'); setIssue(null); } catch (e) { setIssue(String(e)); } finally { setBusy(false); } };
  if (issue === null) return children;
  if (issue === undefined) return <TetroStartupScreen />;
  return <main className="tetro-startup" role="alert">
    <h1>Your meeting library couldn’t open</h1><p>Tetro has kept the files in place. Try again, or open the data folder when asking for help.</p>
    <div className="tetro-dialog-actions"><button className="tetro-key" disabled={busy} onClick={() => void retry()}>{busy ? 'Opening…' : 'Try again'}</button><button className="tetro-key" onClick={() => void invoke('open_tetro_folder', { kind: 'profile' }).catch(e => setIssue(String(e)))}>Open data folder</button></div>
    <details><summary>Technical details</summary><pre>{issue}</pre></details>
  </main>;
}
