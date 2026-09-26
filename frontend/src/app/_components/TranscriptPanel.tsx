import { RecordingReady } from '@/components/tetro/RecordingReady';
import { SetupGuide } from '@/components/tetro/SetupGuide';
import { getWhisperDisplayName } from '@/lib/whisper';

import { getModelDisplayName } from '@/lib/parakeet';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { PermissionWarning } from '@/components/PermissionWarning';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, GlobeIcon, SlidersHorizontal, AudioLines } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { useMemo } from 'react';
import { isPrimaryLanguageSelectionAvailable } from '@/lib/transcription-language-routing';
import { recordingLanguageLabel } from '@/lib/recording-setup';

const whisperLabel = (model: string) => { const name = getWhisperDisplayName(model); return /armenian/i.test(name) ? name : `Whisper ${name}`; };

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  onStartRecording: () => Promise<void>;
  startDisabled: boolean;
  showModal: (name: ModalType, message?: string) => void;
}

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal,
  onStartRecording,
  startDisabled,
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, transcriptContainerRef, copyTranscript } = useTranscripts();
  const { transcriptModelConfig, selectedLanguage } = useConfig();
  const languageLabel = recordingLanguageLabel(transcriptModelConfig.provider, transcriptModelConfig.model, selectedLanguage);
  const modelLabel = !transcriptModelConfig.model ? 'Choose model' : transcriptModelConfig.provider === 'parakeet'
    ? getModelDisplayName(transcriptModelConfig.model) : transcriptModelConfig.provider === 'localWhisper'
      ? whisperLabel(transcriptModelConfig.model) : transcriptModelConfig.model;
  const { isRecording, isPaused, isStartingRecording } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    })),
    [transcripts]
  );

  return <div ref={transcriptContainerRef} className="tetro-home-panel tetro-sheet">
    <div className="tetro-pane-toolbar tetro-live-toolbar"><span>{transcripts.length ? `${transcripts.length} ${transcripts.length === 1 ? 'line' : 'lines'} so far` : isRecording ? (isPaused ? 'Paused' : 'Listening…') : 'New recording'}</span>
      {transcripts.length > 0 && <Button variant="outline" size="sm" onClick={copyTranscript} title="Copy transcript"><Copy />Copy</Button>}
      {isPrimaryLanguageSelectionAvailable(transcriptModelConfig.provider) && <Button variant="outline" size="sm" onClick={() => showModal('languageSettings')} title="Transcription language"><GlobeIcon />Language</Button>}
      <Button variant="outline" size="sm" onClick={() => showModal('modelSelector')} title="Transcription model"><SlidersHorizontal />{transcriptModelConfig.provider === 'parakeet' ? getModelDisplayName(transcriptModelConfig.model) : transcriptModelConfig.model ? whisperLabel(transcriptModelConfig.model) : 'Choose model'}</Button>
      <Button variant="outline" size="sm" onClick={() => showModal('deviceSettings')} title="Microphone and system audio"><AudioLines />Audio</Button>
    </div>
    {!isRecording && transcripts.length === 0 && <SetupGuide onChooseTranscription={() => showModal('modelSelector')} />}
    {!isRecording && !isChecking && !isLinux && <div className="px-4"><PermissionWarning hasMicrophone={hasMicrophone} hasSystemAudio={hasSystemAudio} onRecheck={checkPermissions} isRechecking={isChecking} /></div>}
    <div className="flex-1 min-h-0 overflow-hidden"><VirtualizedTranscriptView segments={segments} isRecording={isRecording} isPaused={isPaused} isProcessing={isProcessingStop} isStopping={isStopping} enableStreaming={isRecording} showConfidence={true} emptyState={<RecordingReady
      onStart={onStartRecording} disabled={startDisabled} starting={isStartingRecording} finishing={isStopping || isProcessingStop}
      language={languageLabel} model={modelLabel}
      onChooseLanguage={() => showModal(isPrimaryLanguageSelectionAvailable(transcriptModelConfig.provider) ? 'languageSettings' : 'modelSelector')}
      onChooseModel={() => showModal('modelSelector')}
    />} /></div>
  </div>;
}
