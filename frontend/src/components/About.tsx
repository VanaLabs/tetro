'use client';
import { TetroLiveBrand } from '@/components/tetro/TetroBrand';
import { Segmented } from '@/components/tetro/SettingRow';
import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useUpdateCheckContext } from './UpdateCheckProvider';
import { reflowLicenseText } from '@/lib/license-text';
import { feedbackUrl } from '@/lib/feedback';

const PRIVACY: [string, string][] = [
  ['Saved on this device', 'Tetro saves recordings, transcripts, summaries and templates on this device. A folder you choose may be synced by another app.'],
  ['Transcription', 'The built-in transcription models process audio on this device.'],
  ['Writing summaries', 'Built-in models stay on this device. A connected provider receives transcript text, template instructions and your names-and-terms hints. The selected summary model also handles automatic meeting names and speaker labels when you use those features. Ollama stays here when its address is local; a remote address sends text to that server.'],
  ['Connections', 'Model downloads and connected providers use the internet. Tetro checks GitHub for new versions. Updates download and install only when you choose. Tetro has no usage tracking or required account.'],
  ['Trash', 'Removed meetings and selected parts can be restored from Trash. They keep taking up space until you delete them permanently.'],
];
export function About() {
  const { isChecking, checkForUpdates, updateInfo, showUpdateDialog } = useUpdateCheckContext();
  const [version, setVersion] = useState('');
  const [tab, setTab] = useState<'about' | 'privacy' | 'licenses'>('about');
  const [licenses, setLicenses] = useState('');
  const [openingFeedback, setOpeningFeedback] = useState(false);
  const feedbackPending = useRef(false);
  const feedbackHintId = useId();
  const openFeedback = async () => {
    if (feedbackPending.current) return;
    feedbackPending.current = true;
    setOpeningFeedback(true);
    try {
      await invoke('open_external_url', { url: feedbackUrl(version) });
    } catch {
      toast.error('Could not open GitHub. Please try again.');
    } finally {
      feedbackPending.current = false;
      setOpeningFeedback(false);
    }
  };
  useEffect(() => { getVersion().then(setVersion).catch(() => setVersion('unavailable')); }, []);
  useEffect(() => { if (tab === 'licenses' && !licenses) void fetch('/tetro/licenses.txt').then(r => { if (!r.ok) throw new Error(); return r.text(); }).then(setLicenses).catch(() => setLicenses('Could not load the license notices. Close and reopen this window to try again.')); }, [tab, licenses]);
  return <div className="tetro-about">
    <Segmented label="About Tetro" value={tab} onChange={setTab} options={[{ value: 'about', label: 'About' }, { value: 'privacy', label: 'Privacy' }, { value: 'licenses', label: 'Licenses' }]} />
    <div className="tetro-about-body" role="tabpanel" aria-label={tab === 'about' ? 'About' : tab === 'privacy' ? 'Privacy' : 'Licenses'}>{tab === 'about' ? <>
      <div className="tetro-about-identity"><h2 aria-label="Tetro"><TetroLiveBrand variant="about" /></h2><p>Vana Labs · {version ? `v${version}` : '…'}</p></div>
      <p className="tetro-about-description">Record conversations. Turn them into transcripts, summaries and action items.</p>
      <p className="tetro-about-note">Use local models or connect your own provider.</p>
      <div className="tetro-dialog-actions tetro-about-actions">
        <button onClick={() => void invoke('open_external_url', { url: 'https://vanalabs.co' }).catch(e => toast.error(String(e)))}>Vana Labs</button>
        <button type="button" disabled={openingFeedback} aria-busy={openingFeedback} aria-describedby={feedbackHintId} onClick={() => void openFeedback()}>Send feedback <ExternalLink size={14} aria-hidden="true" /></button>
        <button disabled={isChecking} onClick={() => updateInfo?.available ? showUpdateDialog() : void checkForUpdates(true)}>{isChecking ? 'Checking…' : updateInfo?.available ? 'Update available' : 'Check for updates'}</button>
      </div>
      <p id={feedbackHintId} className="tetro-about-feedback-hint">Opens GitHub. Posts are public and require an account.</p>
    </> : tab === 'privacy' ? <dl className="tetro-privacy">{PRIVACY.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}</dl>
    : <div className="tetro-license-text"><pre>{licenses ? reflowLicenseText(licenses) : 'Loading notices…'}</pre></div>}</div>
  </div>;
}
