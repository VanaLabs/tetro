import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, Download, Loader2, Mic, NotebookPen } from 'lucide-react';
import { ParakeetAPI, type ParakeetModelInfo } from '@/lib/parakeet';
import { requestModelActivation } from '@/lib/model-activation';
import { DEFAULT_PARAKEET_MODEL } from '@/lib/transcription-language-routing';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TetroBrand } from '@/components/tetro/TetroBrand';
import { OnboardingContainer } from '../OnboardingContainer';
import {
  isStarterTranscriptionReady,
  STARTER_TRANSCRIPTION_MODEL,
  useOnboarding,
} from '@/contexts/OnboardingContext';
import { getSummaryModelSizeMb } from '@/lib/onboarding-summary-model';

type DownloadStatus = 'idle' | 'downloading' | 'cancelling' | 'paused' | 'error';

// Recommended speech model, offered next to the bundled Whisper Tiny.
const RECOMMENDED_SPEECH_MODEL = DEFAULT_PARAKEET_MODEL;
const RECOMMENDED_SPEECH_MB = 670;
// Short names for the summary card; the recommended model is Qwen 3.5 2B.
const SUMMARY_MODEL_NAMES: Record<string, string> = {
  'qwen3.5:2b': 'Qwen 3.5 2B',
  'qwen3.5:4b': 'Qwen 3.5 4B',
  'gemma3:1b': 'Gemma 3 1B',
  'gemma3:4b': 'Gemma 3 4B',
};
const formatSize = (mb: number) => mb >= 1000 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`;

export function DownloadProgressStep({ isMac }: { isMac: boolean }) {
  const {
    goNext,
    whisperReady,
    setWhisperReady,
    summaryModelDownloaded,
    setSummaryModelDownloaded,
    selectedSummaryModel,
    completeOnboarding,
  } = useOnboarding();
  const [speechStatus, setSpeechStatus] = useState<DownloadStatus>('idle');
  const [notesStatus, setNotesStatus] = useState<DownloadStatus>('idle');
  const [speechProgress, setSpeechProgress] = useState(0);
  const [notesProgress, setNotesProgress] = useState(0);
  const [notesPartialMb, setNotesPartialMb] = useState(0);
  const [speechError, setSpeechError] = useState('');
  const [notesError, setNotesError] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [parakeetStatus, setParakeetStatus] = useState<DownloadStatus>('idle');
  const [parakeetReady, setParakeetReady] = useState(false);
  const [parakeetProgress, setParakeetProgress] = useState(0);
  const [parakeetError, setParakeetError] = useState('');

  useEffect(() => {
    let active = true;
    ParakeetAPI.getAvailableModels().then((models: ParakeetModelInfo[]) => {
      if (!active) return;
      const model = models.find(m => m.name === RECOMMENDED_SPEECH_MODEL);
      if (model?.status === 'Available') setParakeetReady(true);
      else if (model && typeof model.status === 'object' && 'Downloading' in model.status) setParakeetStatus('downloading');
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const refreshNotesStatus = useCallback(async () => {
    const info = await invoke<{ status: { type: string; downloaded_mb?: number } } | null>('builtin_ai_get_model_info', { modelName: selectedSummaryModel });
    if (info?.status.type === 'paused') {
      setNotesPartialMb(info.status.downloaded_mb ?? 0);
      setNotesStatus('paused');
    } else if (info?.status.type === 'available') {
      setSummaryModelDownloaded(true);
      setNotesStatus('idle');
    } else if (info?.status.type === 'downloading') {
      setNotesStatus('downloading');
    } else {
      setNotesPartialMb(0);
      setNotesStatus('idle');
    }
  }, [selectedSummaryModel, setSummaryModelDownloaded]);

  useEffect(() => { void refreshNotesStatus().catch(() => {}); }, [refreshNotesStatus]);

  useEffect(() => {
    const listeners = [
      listen<{ modelName: string; progress: number; status?: string }>('parakeet-model-download-progress', (event) => {
        if (event.payload.modelName !== RECOMMENDED_SPEECH_MODEL) return;
        if (event.payload.status === 'cancelled') { setParakeetStatus('idle'); return; }
        setParakeetStatus('downloading');
        setParakeetProgress(event.payload.progress);
      }),
      listen<{ modelName: string }>('parakeet-model-download-complete', (event) => {
        if (event.payload.modelName !== RECOMMENDED_SPEECH_MODEL) return;
        setParakeetStatus('idle');
        setParakeetProgress(100);
        setParakeetReady(true);
      }),
      listen<{ modelName: string; error: string }>('parakeet-model-download-error', (event) => {
        if (event.payload.modelName !== RECOMMENDED_SPEECH_MODEL) return;
        setParakeetStatus('error');
        setParakeetError(event.payload.error);
      }),
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
        } else if (event.payload.status === 'cancelled') {
          void refreshNotesStatus().catch(() => setNotesStatus('idle'));
        } else if (event.payload.status === 'error') {
          setNotesError(event.payload.error || 'Download failed.');
          void refreshNotesStatus().catch(() => setNotesStatus('error'));
        } else {
          setNotesStatus('downloading');
        }
      }),
    ];
    return () => { listeners.forEach((listener) => { void listener.then((unlisten) => unlisten()); }); };
  }, [selectedSummaryModel, setSummaryModelDownloaded, setWhisperReady, refreshNotesStatus]);

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

  const downloadParakeet = async () => {
    setParakeetStatus('downloading');
    setParakeetError('');
    // Switch transcription to it as soon as it finishes, like "Download and use" in Settings.
    requestModelActivation('parakeet', RECOMMENDED_SPEECH_MODEL);
    try {
      await ParakeetAPI.init();
      await ParakeetAPI.downloadModel(RECOMMENDED_SPEECH_MODEL);
    } catch (error) {
      if (String(error).toLowerCase().includes('cancel')) { setParakeetStatus('idle'); return; }
      setParakeetStatus('error');
      setParakeetError(String(error));
    }
  };

  const downloadRecommended = () => {
    if (!parakeetReady && parakeetStatus !== 'downloading') void downloadParakeet();
    if (!summaryModelDownloaded && notesStatus !== 'downloading' && notesStatus !== 'cancelling') void downloadNotes();
  };

  const downloadNotes = async () => {
    setNotesStatus('downloading');
    setNotesError('');
    try {
      await invoke('builtin_ai_download_model', { modelName: selectedSummaryModel, selectWhenReady: true });
      const ready = await invoke<boolean>('builtin_ai_is_model_ready', {
        modelName: selectedSummaryModel,
        refresh: true,
      });
      setSummaryModelDownloaded(ready);
      if (!ready) throw new Error('The downloaded model could not be verified.');
      setNotesStatus('idle');
    } catch (error) {
      if (String(error).startsWith('CANCELLED:')) return;
      setNotesError(String(error));
      await refreshNotesStatus().catch(() => setNotesStatus('error'));
    }
  };

  const cancelNotes = async () => {
    setNotesStatus('cancelling');
    try {
      await invoke('builtin_ai_cancel_download', { modelName: selectedSummaryModel });
      await refreshNotesStatus();
    } catch (error) {
      setNotesStatus('downloading');
      toast.error('Couldn’t stop the download', { description: String(error) });
    }
  };

  const deletePartialNotes = async () => {
    try {
      await invoke('builtin_ai_delete_model', { modelName: selectedSummaryModel });
      setNotesPartialMb(0);
      setNotesError('');
      setNotesStatus('idle');
    } catch (error) {
      toast.error('Couldn’t delete the partial download', { description: String(error) });
    }
  };

  const handleContinue = async () => {
    setFinishing(true);
    try {
      // Models are optional at this point: people can finish setup now and download later.
      setWhisperReady(await isStarterTranscriptionReady().catch(() => false));
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

  const notesBusy = notesStatus === 'downloading' || notesStatus === 'cancelling';
  const parakeetBusy = parakeetStatus === 'downloading';
  const summaryMb = getSummaryModelSizeMb(selectedSummaryModel) || 1221;
  const summaryModelName = SUMMARY_MODEL_NAMES[selectedSummaryModel] ?? selectedSummaryModel;
  const remainingMb = (parakeetReady || parakeetBusy ? 0 : RECOMMENDED_SPEECH_MB) + (summaryModelDownloaded || notesBusy ? 0 : summaryMb);
  const allReady = whisperReady && parakeetReady && summaryModelDownloaded;
  const downloading = parakeetBusy || notesBusy;

  return (
    <OnboardingContainer
      title={<>Choose what <span className="mx-1 inline-flex align-middle"><TetroBrand variant="onboarding" /><span className="sr-only">Tetro</span></span> can do</>}
      description="Tetro works right away with a built-in speech model. For more accurate transcripts and AI summaries, download the recommended models now or later in Settings."
      step={2}
      totalSteps={isMac ? 3 : 2}
      footer={<div className="tetro-setup-footer">
        {remainingMb > 0 && <Button onClick={downloadRecommended} disabled={finishing} className="w-full h-11 tetro-key tetro-key-amber">
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />Download recommended ({formatSize(remainingMb)})
        </Button>}
        <Button onClick={handleContinue} disabled={finishing} className={`w-full h-11 tetro-key ${remainingMb === 0 ? 'tetro-key-amber' : ''}`}>
          {finishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {allReady ? 'Continue' : downloading && remainingMb === 0 ? 'Continue while it downloads' : 'Continue and set up later'}
        </Button>
        {downloading && <p className="tetro-setup-note">Downloads keep going in the background. You can start using Tetro now.</p>}
      </div>}
    >
      <div className="mx-auto w-full max-w-lg space-y-2.5">
        <section className="tetro-setup-card">
          <div className="flex items-start gap-3">
            <Mic className="mt-0.5 h-5 w-5 shrink-0 text-[var(--tetro-muted)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="tetro-setup-title">Written transcript <span>Turns your recording into text</span></h2>

              <div className="tetro-setup-model">
                <div className="min-w-0 flex-1">
                  <strong>Whisper Tiny</strong> <span className="tetro-setup-meta">Built in · 74 MB</span>
                  <small>Works right away. Fast, basic accuracy.</small>
                </div>
                {whisperReady ? <span className="tetro-setup-ready"><Check aria-hidden="true" />Ready</span>
                  : <Button size="sm" className="tetro-key" aria-label="Download Whisper Tiny" onClick={downloadSpeech} disabled={speechStatus === 'downloading'}>
                    {speechStatus === 'downloading' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
                    {speechStatus === 'downloading' ? 'Downloading' : 'Download'}
                  </Button>}
              </div>
              {speechStatus === 'downloading' && <progress className="mt-2 w-full" max={100} value={speechProgress} aria-label="Whisper Tiny download" />}
              {speechError && <p role="alert" className="mt-2 text-sm text-[var(--tetro-red)]">{speechError}</p>}

              <div className="tetro-setup-model is-recommended">
                <div className="min-w-0 flex-1">
                  <strong>Parakeet</strong> <span className="tetro-setup-badge">Recommended</span> <span className="tetro-setup-meta">{formatSize(RECOMMENDED_SPEECH_MB)}</span>
                  <small>Much more accurate, in real time. 25 languages, including English and Russian; others use Whisper.</small>
                </div>
                {parakeetReady ? <span className="tetro-setup-ready"><Check aria-hidden="true" />Ready</span>
                  : <Button size="sm" className="tetro-key" aria-label="Download Parakeet" onClick={() => void downloadParakeet()} disabled={parakeetBusy}>
                    {parakeetBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
                    {parakeetBusy ? `${Math.round(parakeetProgress)}%` : 'Download'}
                  </Button>}
              </div>
              {parakeetBusy && <progress className="mt-2 w-full" max={100} value={parakeetProgress} aria-label="Parakeet download" />}
              {parakeetError && <p role="alert" className="mt-2 text-sm text-[var(--tetro-red)]">{parakeetError}</p>}
            </div>
          </div>
        </section>

        <section className="tetro-setup-card">
          <div className="flex items-start gap-3">
            <NotebookPen className="mt-0.5 h-5 w-5 shrink-0 text-[var(--tetro-muted)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="tetro-setup-title">AI summary <span>Needed for summaries and action items</span></h2>
              <div className="tetro-setup-model">
                <div className="min-w-0 flex-1">
                  <strong>{summaryModelName}</strong> <span className="tetro-setup-meta">{formatSize(summaryMb)}</span>
                  <small>Multilingual. Runs on your device and works offline.</small>
                </div>
                {summaryModelDownloaded ? <span className="tetro-setup-ready"><Check aria-hidden="true" />Ready</span>
                  : notesStatus === 'paused' ? <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={deletePartialNotes}>Delete</Button>
                    <Button size="sm" className="tetro-key" onClick={downloadNotes}>Resume</Button>
                  </div>
                  : <div className="flex gap-2">
                    <Button size="sm" className="tetro-key" aria-label="Download for summaries" onClick={downloadNotes} disabled={notesBusy}>
                      {notesBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
                      {notesStatus === 'cancelling' ? 'Stopping…' : notesStatus === 'downloading' ? `${Math.round(notesProgress)}%` : 'Download'}
                    </Button>
                    {notesStatus === 'downloading' && <Button variant="outline" size="sm" onClick={cancelNotes}>Cancel</Button>}
                  </div>}
              </div>
              {notesStatus === 'paused' && <p className="mt-2 text-sm text-[var(--tetro-muted)]">Paused · {notesPartialMb} MiB kept on this device.</p>}
              {notesStatus === 'downloading' && <progress className="mt-2 w-full" max={100} value={notesProgress} aria-label="Summary model download" />}
              {notesError && <p role="alert" className="mt-2 text-sm text-[var(--tetro-red)]">{notesError}</p>}
            </div>
          </div>
        </section>
      </div>
    </OnboardingContainer>
  );
}
