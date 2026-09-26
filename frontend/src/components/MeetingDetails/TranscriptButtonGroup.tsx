"use client";

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, FolderOpen, RefreshCw, Globe } from 'lucide-react';
import { LanguageSelection } from '@/components/LanguageSelection';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useRecordingState } from '@/contexts/RecordingStateContext';

import { RetranscribeDialog } from './RetranscribeDialog';
import { useConfig } from '@/contexts/ConfigContext';
import { MeetingVersions } from '@/components/tetro/MeetingVersions';

interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
  /** Extra keys shown at the end of the same group (e.g. Beta speakers). */
  extra?: React.ReactNode;
}

export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onOpenMeetingFolder,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
  extra,
}: TranscriptButtonGroupProps) {
  const { betaFeatures, selectedLanguage, transcriptModelConfig } = useConfig();
  const { isRecording } = useRecordingState();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [showRetranscribeDialog, setShowRetranscribeDialog] = useState(false);

  const handleRetranscribeComplete = useCallback(async () => {
    // Refetch transcripts to show the updated data
    if (onRefetchTranscripts) {
      await onRefetchTranscripts();
    }
  }, [onRefetchTranscripts]);

  return (
    <div className="flex items-center gap-2 min-w-0">
      <ButtonGroup>
        <Button variant="outline" size="sm" title="Transcription language" aria-label="Transcription language" onClick={() => setLanguageOpen(true)}><Globe /></Button>
        <Button
          variant="outline"
          size="sm"
          className="px-2 @[30rem]:px-3"
          onClick={() => {

            onCopyTranscript();
          }}
          disabled={transcriptCount === 0}
          title={transcriptCount === 0 ? 'No transcript to copy' : 'Copy transcript'}
          aria-label="Copy transcript"
        >
          <Copy />
          <span className="hidden @[30rem]:inline">Copy</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="px-2 @[30rem]:px-4"
          onClick={() => {

            onOpenMeetingFolder();
          }}
          title="Show the recording in Finder"
          aria-label="Open recording folder"
        >
          <FolderOpen className="@[30rem]:mr-2" size={18} />
          <span className="hidden @[30rem]:inline">Folder</span>
        </Button>

        {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
          <Button
            size="sm"
            variant="outline"
            className="bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 border-blue-200 px-2 @[30rem]:px-4 dark:text-foreground"
            onClick={() => {

              setShowRetranscribeDialog(true);
            }}
            title="Transcribe the recording again with another language or model"
            aria-label="Retranscribe"
          >
            <RefreshCw className="@[30rem]:mr-2" size={18} />
            <span className="hidden @[30rem]:inline">Retranscribe</span>
          </Button>
        )}
        {extra}
        {meetingId && <MeetingVersions meetingId={meetingId} kind="transcript" onRestored={onRefetchTranscripts} />}
      </ButtonGroup>

      <Dialog open={languageOpen} onOpenChange={setLanguageOpen}><DialogContent><DialogTitle>Transcription language</DialogTitle><DialogDescription>Used for new recordings. To change an existing transcript, use Retranscribe.</DialogDescription><LanguageSelection selectedLanguage={selectedLanguage} disabled={isRecording} provider={transcriptModelConfig.provider} /></DialogContent></Dialog>
      {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
        <RetranscribeDialog
          open={showRetranscribeDialog}
          onOpenChange={setShowRetranscribeDialog}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onComplete={handleRetranscribeComplete}
        />
      )}
    </div>
  );
}
