import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, Download, Loader2, Mic, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import {
  isStarterTranscriptionReady,
  STARTER_TRANSCRIPTION_MODEL,
  useOnboarding,
} from '@/contexts/OnboardingContext';
import { getSummaryModelSizeLabel } from '@/lib/onboarding-summary-model';

type DownloadStatus = 'idle' | 'downloading' | 'error';

export function DownloadProgressStep() {
  const {
    goNext,
    whisperReady,
    setWhisperReady,
    summaryModelDownloaded,
    setSummaryModelDownloaded,
    selectedSummaryModel,
    completeOnboarding,
  } = useOnboarding();
  const [isMac, setIsMac] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<DownloadStatus>('idle');
  const [notesStatus, setNotesStatus] = useState<DownloadStatus>('idle');
  const [speechProgress, setSpeechProgress] = useState(0);
  const [notesProgress, setNotesProgress] = useState(0);
  const [speechError, setSpeechError] = useState('');
  const [notesError, setNotesError] = useState('');
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };
    void checkPlatform();
  }, []);

  useEffect(() => {
    const listeners = [
      listen<{ modelName: string; progress: number }>('model-download-progress', (event) => {
        if (event.payload.modelName !== STARTER_TRANSCRIPTION_MODEL) return;
        setSpeechStatus('downloading');
        setSpeechProgress(event.payload.progress);
      }),
      listen<{ modelName: string }>('model-download-complete', (event) => {
        if (event.payload.modelName !== STARTER_TRANSCRIPTION_MODEL) return;
        setSpeechStatus('idle');
        setSpeechProgress(100);
        setWhisperReady(true);
      }),
      listen<{ modelName: string; error: string }>('model-download-error', (event) => {
        if (event.payload.modelName !== STARTER_TRANSCRIPTION_MODEL) return;
        setSpeechStatus('error');
        setSpeechError(event.payload.error);
      }),
      listen<{ model: string; progress: number; status: string; error?: string }>('builtin-ai-download-progress', (event) => {
        if (event.payload.model !== selectedSummaryModel) return;
        setNotesProgress(event.payload.progress);
        if (event.payload.status === 'completed') {
          setNotesStatus('idle');
          setSummaryModelDownloaded(true);
        } else if (event.payload.status === 'error') {
          setNotesStatus('error');
          setNotesError(event.payload.error || 'Download failed.');
        } else {
          setNotesStatus('downloading');
        }
      }),
    ];
    return () => { listeners.forEach((listener) => { void listener.then((unlisten) => unlisten()); }); };
  }, [selectedSummaryModel, setSummaryModelDownloaded, setWhisperReady]);

  const downloadSpeech = async () => {
    setSpeechStatus('downloading');
    setSpeechError('');
    try {
      await invoke('whisper_init');
      await invoke('whisper_download_model', { modelName: STARTER_TRANSCRIPTION_MODEL });
      const ready = await isStarterTranscriptionReady();
      setWhisperReady(ready);
      if (!ready) throw new Error('The downloaded model could not be verified.');
      setSpeechStatus('idle');
    } catch (error) {
      setSpeechStatus('error');
      setSpeechError(String(error));
    }
  };

  const downloadNotes = async () => {
    setNotesStatus('downloading');
    setNotesError('');
    try {
      await invoke('builtin_ai_download_model', { modelName: selectedSummaryModel });
      const ready = await invoke<boolean>('builtin_ai_is_model_ready', {
        modelName: selectedSummaryModel,
        refresh: true,
      });
      setSummaryModelDownloaded(ready);
      if (!ready) throw new Error('The downloaded model could not be verified.');
      setNotesStatus('idle');
    } catch (error) {
      setNotesStatus('error');
      setNotesError(String(error));
    }
  };

  const handleContinue = async () => {
    setFinishing(true);
    try {
      if (!(await isStarterTranscriptionReady())) {
        setWhisperReady(false);
        throw new Error('Download Whisper Tiny to continue.');
      }
      setWhisperReady(true);
      if (isMac) {
        goNext();
      } else {
        await completeOnboarding();
        window.location.reload();
      }
    } catch (error) {
      toast.error('Setup could not continue', { description: String(error) });
    } finally {
      setFinishing(false);
    }
  };

  return (
    <OnboardingContainer
      title="Start with small local models"
      description="Tetro only downloads a model when you choose to."
      step={3}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="mx-auto w-full max-w-lg space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-start gap-3">
            <Mic className="mt-1 h-5 w-5 shrink-0 text-gray-700" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-gray-900">Whisper Tiny · transcription</h2>
              <p className="mt-1 text-sm text-gray-600">
                About 74 MiB. Included in the desktop app; download only if it is missing.
              </p>
              {whisperReady ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-green-700"><Check className="h-4 w-4" /> Ready</p>
              ) : (
                <Button className="mt-3 tetro-key tetro-key-amber" onClick={downloadSpeech} disabled={speechStatus === 'downloading'}>
                  {speechStatus === 'downloading' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  {speechStatus === 'downloading' ? 'Downloading' : 'Download Whisper Tiny'}
                </Button>
              )}
              {speechStatus === 'downloading' && <progress className="mt-3 w-full" max={100} value={speechProgress} aria-label="Whisper Tiny download" />}
              {speechError && <p role="alert" className="mt-2 text-sm text-red-600">{speechError}</p>}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 h-5 w-5 shrink-0 text-gray-700" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-gray-900">Gemma 3 1B · local notes</h2>
              <p className="mt-1 text-sm text-gray-600">
                {getSummaryModelSizeLabel(selectedSummaryModel)}. The smallest built-in notes model.
                Download it now or add it later from Models.
              </p>
              {summaryModelDownloaded ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-green-700"><Check className="h-4 w-4" /> Ready</p>
              ) : (
                <Button className="mt-3 tetro-key" onClick={downloadNotes} disabled={notesStatus === 'downloading'}>
                  {notesStatus === 'downloading' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  {notesStatus === 'downloading' ? 'Downloading' : 'Download for local notes'}
                </Button>
              )}
              {notesStatus === 'downloading' && <progress className="mt-3 w-full" max={100} value={notesProgress} aria-label="Local notes model download" />}
              {notesError && <p role="alert" className="mt-2 text-sm text-red-600">{notesError}</p>}
            </div>
          </div>
        </section>

        <p className="text-sm text-gray-600">You can record and edit transcripts without the notes model.</p>
        <Button onClick={handleContinue} disabled={!whisperReady || finishing} className="w-full tetro-key tetro-key-amber">
          {finishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Continue
        </Button>
      </div>
    </OnboardingContainer>
  );
}
