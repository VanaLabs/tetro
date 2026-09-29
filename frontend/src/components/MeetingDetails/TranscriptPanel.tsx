"use client";

import { allTranscriptLines } from '@/lib/all-transcript-lines';
import { SavedEdit, TEXT_UPDATED, correctName, nameCorrection } from '@/lib/meeting-edits';
import { RetranscribeDialog } from './RetranscribeDialog';
import { useRetranscription } from '@/components/tetro/RetranscribeProgress';
import { SpeakersButton } from '@/components/tetro/Speakers';
import { useConfig } from '@/contexts/ConfigContext';
import { FindBar, useTranscriptFind } from '@/components/tetro/TranscriptFind';
import { PlaybackProvider } from '@/components/tetro/MeetingPlayer';
import { Transcript, TranscriptSegmentData } from '@/types';
import { TranscriptView } from '@/components/TranscriptView';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MarksStrip } from '@/components/tetro/MarksStrip';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { replaceEverywhere, singleWordChange } from '@/lib/transcriptEdit';
import { addVocabularyTerm } from '@/components/tetro/Vocabulary';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptPanelProps) {
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      speaker: t.speaker,
    }));
  }, [transcripts, usePagination, segments]);

  const [wholeTranscript, setWholeTranscript] = useState<TranscriptSegmentData[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchRevision, setSearchRevision] = useState(0);
  const [editedLines, setEditedLines] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    invoke<SavedEdit[]>('api_get_meeting_edits', { meetingId }).then(rows => { if (!cancelled) setEditedLines(Object.fromEntries(rows.filter(e => e.kind === 'transcript').map(e => [e.anchor, e.needs_review]))); }).catch(() => {});
    return () => { cancelled = true; };
  }, [meetingId, searchRevision, segments, transcripts]);
  useEffect(() => {
    const update = (event: Event) => { if ((event as CustomEvent).detail.meetingId === meetingId) { void onRefetchTranscripts?.(); setSearchRevision(r => r + 1); } };
    window.addEventListener(TEXT_UPDATED, update);
    return () => window.removeEventListener(TEXT_UPDATED, update);
  }, [meetingId, onRefetchTranscripts]);
  const [showRetranscribe, setShowRetranscribe] = useState(false);
  const displaySegments = wholeTranscript ?? convertedSegments;
  const find = useTranscriptFind(displaySegments);
  useEffect(() => {
    let cancelled = false;
    setWholeTranscript(null); setSearchError('');
    if (!find.open || !meetingId) { setSearchLoading(false); return; }
    setSearchLoading(true);
    allTranscriptLines<Transcript>((offset, limit) => invoke('api_get_meeting_transcripts', { meetingId, offset, limit }), () => cancelled)
      .then(lines => { if (!cancelled) setWholeTranscript(lines.map(t => ({ id: t.id, text: t.text, timestamp: t.audio_start_time ?? 0, endTime: t.audio_end_time, speaker: t.speaker }))); })
      .catch(e => { if (!cancelled) setSearchError(String(e)); })
      .finally(() => { if (!cancelled) setSearchLoading(false); });
    return () => { cancelled = true; };
  }, [find.open, meetingId, searchRevision]);
  const refresh = async () => { await onRefetchTranscripts?.(); setSearchRevision(r => r + 1); };
  const retranscription = useRetranscription(meetingId, refresh);
  const { betaFeatures } = useConfig();
  // Arriving from library search (?q=…): open find with that text.
  const searchParams = useSearchParams();
  const arrivedQuery = searchParams?.get('q') ?? '';
  useEffect(() => {
    if (!arrivedQuery) return;
    find.setOpen(true);
    find.setQuery(arrivedQuery);
  }, [arrivedQuery, meetingId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [marks, setMarks] = useState<number[]>([]);
  useEffect(() => {
    if (!meetingId) return;
    invoke<{ at_seconds: number }[]>('api_get_meeting_marks', { meetingId }).then(m => setMarks(m.map(x => x.at_seconds))).catch(() => setMarks([]));
  }, [meetingId]);

  // Hand corrections. A one-word fix offers to fix the same word in every other line.
  const [replaceOffer, setReplaceOffer] = useState<{ from: string; to: string; lines: { id: string; text: string; count: number }[] } | null>(null);
  const [replacing, setReplacing] = useState(false);
  const allLines = useCallback(async () => {
    if (!meetingId) return convertedSegments.map(s => ({ id: s.id, text: s.text }));
    const all = await invoke<{ transcripts: { id: string; text: string }[] }>('api_get_meeting_transcripts', { meetingId, limit: 100000, offset: 0 });
    return all.transcripts.map(t => ({ id: t.id, text: t.text }));
  }, [meetingId, convertedSegments]);
  const editLine = useCallback(async (id: string, text: string) => {
    if (!meetingId) return;
    const before = displaySegments.find(s => s.id === id)?.text ?? '';
    try {
      await invoke('api_update_transcript_lines', { meetingId, edits: [{ id, text }] });
      const name = nameCorrection(before, text);
      if (name) { await correctName(meetingId, name.from, name.to); setReplaceOffer(null); }
      const change = singleWordChange(before, text);
      if (change && !name) {
        const lines = replaceEverywhere(await allLines(), change.from, change.to, id);
        setReplaceOffer(lines.length ? { ...change, lines } : null);
      }
      await onRefetchTranscripts?.();
      setSearchRevision(r => r + 1);
    } catch (e) {
      toast.error('Couldn’t save the correction', { description: String(e) });
      throw e;
    }
  }, [meetingId, displaySegments, allLines, onRefetchTranscripts]);
  const replaceAll = async () => {
    if (!replaceOffer || !meetingId) return;
    setReplacing(true);
    try {
      await correctName(meetingId, replaceOffer.from, replaceOffer.to);
      setReplaceOffer(null);
      await onRefetchTranscripts?.();
      setSearchRevision(r => r + 1);
    } catch (e) {
      toast.error('Couldn’t replace the other lines', { description: String(e) });
    } finally { setReplacing(false); }
  };

  return (
    <PlaybackProvider meetingId={meetingId}>
    <div className="flex h-full min-w-0 w-full bg-white flex-col relative @container">
      {/* Title area */}
      <div className="tetro-pane-toolbar">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
          extra={betaFeatures.speakerLabels && meetingId && !isRecording
            ? <SpeakersButton meetingId={meetingId} hasLabels={convertedSegments.some(s => s.speaker)} onDone={async () => { await onRefetchTranscripts?.(); }} />
            : null}
        />
      </div>

      <FindBar find={find} loading={searchLoading} error={searchError} />
      {searchError && <button className="tetro-link" onClick={() => setSearchRevision(r => r + 1)}>Retry full transcript search</button>}
      {marks.length > 0 && <MarksStrip marks={marks} segments={displaySegments} />}
      {replaceOffer && (() => {
        const total = replaceOffer.lines.reduce((n, l) => n + l.count, 0);
        return <div className="tetro-replace-offer" role="status">
          <span>Change <b>{total}</b> more “{replaceOffer.from}” to “{replaceOffer.to}”?</span>
          {/(\p{Lu}|\p{N})/u.test(replaceOffer.to) || replaceOffer.to.length >= 5 ? <button className="tetro-link" onClick={() => { const term = replaceOffer.to; void addVocabularyTerm(term).then(() => toast.success(`“${term}” added to names & terms`)).catch(e => toast.error(String(e))); }} title="Spell it this way in future transcripts and summaries">Add “{replaceOffer.to}” to names &amp; terms</button> : null}
          <button className="tetro-key" onClick={() => setReplaceOffer(null)} disabled={replacing}>Not now</button>
          <button className="tetro-key tetro-key-amber" onClick={() => void replaceAll()} disabled={replacing}>{replacing ? 'Replacing…' : 'Replace all'}</button>
        </div>;
      })()}

      {/* Transcript content - use virtualized view for better performance */}
      {retranscription.view}
      <div className="flex-1 min-h-0 overflow-hidden" hidden={retranscription.active}>
        <VirtualizedTranscriptView
          segments={displaySegments}
          editedLines={editedLines}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={wholeTranscript ? false : hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={wholeTranscript?.length ?? totalCount}
          loadedCount={wholeTranscript?.length ?? loadedCount}
          onLoadMore={onLoadMore}
          find={find.state}
          marks={marks}
          speakerLabels={betaFeatures.speakerLabels && meetingId ? { meetingId, onRenamed: async () => { await onRefetchTranscripts?.(); } } : undefined}
          onEditSegment={meetingId && !isRecording ? editLine : undefined}
          emptyState={meetingId ? <div className="tetro-ready"><p className="tetro-ready-title">No transcript yet</p><p className="tetro-ready-sub">{meetingFolderPath ? 'Your recording is saved. Turn its speech into text when you’re ready.' : 'There are no transcript lines or linked recording for this meeting.'}</p>{meetingFolderPath && <button className="tetro-key tetro-key-amber" onClick={() => setShowRetranscribe(true)}>Transcribe recording</button>}</div> : undefined}
        />
      </div>

    </div>
    {meetingId && <RetranscribeDialog open={showRetranscribe} onOpenChange={setShowRetranscribe} meetingId={meetingId} meetingFolderPath={meetingFolderPath ?? null} onComplete={() => void refresh()} />}
    </PlaybackProvider>
  );
}
