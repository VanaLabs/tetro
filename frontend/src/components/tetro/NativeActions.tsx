'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { About } from '@/components/About';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function NativeActions() {
  const router = useRouter(); const pathname = usePathname();
  const { openImportDialog } = useImportDialog();
  const { isRecording } = useRecordingState();
  const [about, setAbout] = useState(false);
  useEffect(() => {
    const showAbout = () => setAbout(true);
    window.addEventListener('tetro:about', showAbout);
    let disposed = false;
    const off = listen<string>('tetro-menu', ({ payload: action }) => {
      if (disposed) return;
      if (action === 'about') return setAbout(true);
      if (action === 'import') return openImportDialog();
      if (action === 'help') return router.push('/help');
      if (action === 'settings' || action === 'shortcuts') {
        if (action === 'shortcuts') { sessionStorage.setItem('tetro.settingsTab', 'recording'); window.dispatchEvent(new CustomEvent('tetro:settings-tab', { detail: 'recording' })); }
        return router.push('/settings');
      }
      if (action === 'new') { if (isRecording) toast('Your current recording is still running'); return router.push('/'); }
      if (action === 'start' && !isRecording) {
        if (pathname === '/') window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
        else { sessionStorage.setItem('autoStartRecording', 'true'); router.push('/'); }
      }
    });
    return () => { disposed = true; void off.then(fn => fn()).catch(() => {}); window.removeEventListener('tetro:about', showAbout); };
  }, [router, pathname, isRecording, openImportDialog]);
  return <Dialog open={about} onOpenChange={setAbout}><DialogContent className="tetro-about-dialog"><DialogTitle className="sr-only">About Tetro</DialogTitle><DialogDescription className="sr-only">Version, credits and privacy</DialogDescription><About /></DialogContent></Dialog>;
}
