'use client';

import { readTranscriptDraft, keepTranscriptDraft, discardTranscriptDraft } from '@/lib/transcript-draft';
import { SpeakerTag } from '@/components/tetro/Speakers';
import { Pencil } from 'lucide-react';
import { Highlighted, type FindState } from '@/components/tetro/TranscriptFind';
import { usePlayback } from '@/components/tetro/MeetingPlayer';
import { useCallback, useRef, useReducer, startTransition, useEffect, useState, memo, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useTranscriptStreaming } from "@/hooks/useTranscriptStreaming";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptSegmentData } from "@/types";

export interface VirtualizedTranscriptViewProps {
    editedLines?: Record<string, boolean>;
    emptyState?: React.ReactNode;
    /** Transcript segments to display */
    segments: TranscriptSegmentData[];
    /** Whether recording is in progress */
    isRecording?: boolean;
    /** Whether recording is paused */
    isPaused?: boolean;
    /** Whether processing/finalizing transcription */
    isProcessing?: boolean;
    /** Whether stopping */
    isStopping?: boolean;
    /** Enable streaming effect for latest segment */
    enableStreaming?: boolean;
    /** Show confidence indicators */
    showConfidence?: boolean;
    /** Completely disable auto-scroll behavior (for meeting details page) */
    disableAutoScroll?: boolean;

    // Pagination props (infinite scroll)
    hasMore?: boolean;
    isLoadingMore?: boolean;
    totalCount?: number;
    loadedCount?: number;
    onLoadMore?: () => void;

    /** Find-in-transcript highlighting (meeting details). */
    find?: FindState;
    /** Saves a hand-corrected line (meeting details). */
    onEditSegment?: (id: string, text: string) => Promise<void>;
    /** Marked moments, in seconds; the line playing at each gets a ◆. */
    marks?: number[];
    /** Beta: show speaker names where the speaker changes. */
    speakerLabels?: { meetingId: string; onRenamed: () => Promise<void> | void };
}

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

// Helper function to format seconds as recording-relative time [MM:SS]
function formatRecordingTime(seconds: number | undefined): string {
    if (seconds === undefined) return '--:--';

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;

    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Helper function to remove filler words and repetitions
function cleanStopWords(text: string): string {
    const stopWords = ['uh', 'um', 'er', 'ah', 'hmm', 'hm', 'eh', 'oh'];

    let cleanedText = text;
    stopWords.forEach(word => {
        const pattern = new RegExp(`\\b${word}\\b[,\\s]*`, 'gi');
        cleanedText = cleanedText.replace(pattern, ' ');
    });

    return cleanedText.replace(/\s+/g, ' ').trim();
}

// Memoized transcript segment component
const TranscriptSegment = memo(function TranscriptSegment({
    id,
    timestamp,
    text,
    confidence,
    isStreaming,
    showConfidence,
    isActive = false,
    onSeek,
    highlight,
    currentOccurrence,
    onEdit,
    isMarked = false,
    edited = false,
    needsReview = false,
}: {
    id: string;
    timestamp: number;
    text: string;
    confidence?: number;
    isStreaming: boolean;
    showConfidence: boolean;
    isActive?: boolean;
    onSeek?: (seconds: number) => void;
    highlight?: string;
    currentOccurrence?: number;
    onEdit?: (id: string, text: string) => Promise<void>;
    isMarked?: boolean;
    edited?: boolean;
    needsReview?: boolean;
}) {
    const displayText = text.trim() === '' ? '[Silence]' : text;
    const stamp = formatRecordingTime(timestamp);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(text);
    const [saving, setSaving] = useState(false);
    const [hasDraft, setHasDraft] = useState(false);
    useEffect(() => { setHasDraft(readTranscriptDraft(id) !== undefined); }, [id]);
    const cancelEdit = () => { discardTranscriptDraft(id); setHasDraft(false); setEditing(false); };
    const clickTimer = useRef<number>();
    // A plain click on the words plays from here; a double-click edits; selecting text does neither.
    const playFromText = onSeek ? () => {
        if (window.getSelection()?.toString()) return;
        window.clearTimeout(clickTimer.current);
        clickTimer.current = window.setTimeout(() => onSeek(timestamp), 230);
    } : undefined;
    const startEdit = onEdit ? () => { window.clearTimeout(clickTimer.current); setDraft(readTranscriptDraft(id) ?? text); setEditing(true); } : undefined;
    const save = async () => {
        if (!onEdit) return;
        const next = draft.trim();
        if (!next || next === text.trim()) { cancelEdit(); return; }
        setSaving(true);
        try { await onEdit(id, next); cancelEdit(); } finally { setSaving(false); }
    };

    return (
        <div id={`segment-${id}`} data-user-edited={edited} className={`tetro-line mb-3 ${isActive ? 'is-playing' : ''} ${onSeek ? 'is-seekable' : ''} ${isMarked ? 'is-marked' : ''}`}>
            <div className="flex items-start gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        {onSeek
                            ? <button type="button" className="tetro-stamp" onClick={() => onSeek(timestamp)} aria-label={`Play from ${stamp}`}>{stamp}</button>
                            : <span className="tetro-stamp">{stamp}</span>}
                    </TooltipTrigger>
                    {confidence !== undefined && showConfidence && (
                        <TooltipContent>
                            <ConfidenceIndicator confidence={confidence} showIndicator={showConfidence} />
                        </TooltipContent>
                    )}
                </Tooltip>
                <div className="flex-1" onClick={editing ? undefined : playFromText} onDoubleClick={editing ? undefined : startEdit}>
                    {editing ? (
                        <div><textarea
                            className="tetro-line-editor"
                            value={draft}
                            autoFocus
                            disabled={saving}
                            rows={Math.max(2, Math.ceil(draft.length / 48))}
                            aria-label={`Edit line at ${stamp}`}
                            onChange={e => { setDraft(e.target.value); keepTranscriptDraft(id, e.target.value); setHasDraft(true); }}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save().catch(() => {}); }
                                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
                            }}
                        /><div className="tetro-line-edit-actions"><small>{saving ? 'Saving…' : 'Enter to save · Shift+Enter for a new line'}</small><button className="tetro-link" disabled={saving} onClick={cancelEdit}>Cancel</button><button className="tetro-link" disabled={saving} onClick={() => void save().catch(() => {})}>Save</button></div></div>
                    ) : isStreaming ? (
                        <p className="tetro-streaming text-base text-gray-800 leading-relaxed">{displayText}</p>
                    ) : (
                        <div><p className="text-base text-gray-800 leading-relaxed"><Highlighted text={displayText} query={highlight} current={currentOccurrence} /></p>{hasDraft && <button className="tetro-link" onClick={e => { e.stopPropagation(); startEdit?.(); }}>Resume unfinished edit</button>}{edited && <small className="tetro-edited-label">{needsReview ? 'Your correction was kept · Review the new text nearby' : 'Edited by you'}</small>}</div>
                    )}
                </div>
                {startEdit && !editing && <button type="button" className="tetro-line-edit" onClick={startEdit} aria-label={`Edit line at ${stamp}`} title="Edit this line (or double-click it)"><Pencil /></button>}
            </div>
        </div>
    );
});

export const VirtualizedTranscriptView: React.FC<VirtualizedTranscriptViewProps> = ({
    emptyState,
    editedLines,
    segments,
    isRecording = false,
    isPaused = false,
    isProcessing = false,
    isStopping = false,
    enableStreaming = false,
    showConfidence = true,
    disableAutoScroll = false,
    hasMore = false,
    isLoadingMore = false,
    totalCount = 0,
    loadedCount = 0,
    onLoadMore,
    find,
    onEditSegment,
    marks,
    speakerLabels,
}) => {
    // Create scroll ref first - shared between virtualizer and auto-scroll hook
    const scrollRef = useRef<HTMLDivElement>(null);
    // Ref for infinite scroll trigger element
    const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

    // Force re-render without flushSync (avoids React warning)
    const [, rerender] = useReducer((x: number) => x + 1, 0);

    // Setup virtualizer for efficient rendering of large lists
    const virtualizer = useVirtualizer({
        count: segments.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 60, // Estimated height per segment
        overscan: 10, // Render extra items above/below viewport
        onChange: () => {
            startTransition(() => {
                rerender();
            });
        },
    });

    // Custom hook for auto-scrolling (supports both virtualized and non-virtualized)
    useAutoScroll({
        scrollRef,
        segments,
        isRecording,
        isPaused,
        virtualizer,
        virtualizationThreshold: VIRTUALIZATION_THRESHOLD,
        disableAutoScroll,
    });

    // Streaming text effect hook (typewriter animation for new transcripts)
    const { streamingSegmentId, getDisplayText } = useTranscriptStreaming(
        segments,
        isRecording,
        enableStreaming
    );

    // Infinite scroll: IntersectionObserver to trigger loading more
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording || segments.length === 0) {
            return;
        }

        const triggerElement = loadMoreTriggerRef.current;
        if (!triggerElement) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
            },
            {
                root: null,
                rootMargin: '100px',
                threshold: 0,
            }
        );

        observer.observe(triggerElement);

        return () => observer.disconnect();
    }, [hasMore, isLoadingMore, onLoadMore, isRecording, segments.length]);

    // Scroll-based fallback for fast scrolling
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording) return;

        const scrollElement = scrollRef.current;
        if (!scrollElement) return;

        let ticking = false;

        const handleScroll = () => {
            if (ticking || isLoadingMore || !hasMore) return;

            ticking = true;
            requestAnimationFrame(() => {
                const { scrollTop, scrollHeight, clientHeight } = scrollElement;
                const scrollBottom = scrollHeight - scrollTop - clientHeight;

                // Trigger load when within 200px of bottom
                if (scrollBottom < 200 && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
                ticking = false;
            });
        };

        scrollElement.addEventListener('scroll', handleScroll, { passive: true });
        return () => scrollElement.removeEventListener('scroll', handleScroll);
    }, [onLoadMore, hasMore, isLoadingMore, isRecording]);

    // Playback (meeting details only): highlight the line being played and keep it in view.
    const playback = usePlayback();
    const activeSegmentId = useMemo(() => {
        if (!playback.available || playback.time <= 0) return null;
        const t = playback.time;
        const index = segments.findIndex((s, i) => t >= s.timestamp && t < (s.endTime ?? segments[i + 1]?.timestamp ?? Infinity));
        return index >= 0 ? segments[index].id : null;
    }, [playback.available, playback.time, segments]);
    useEffect(() => {
        if (!playback.playing || !activeSegmentId) return;
        document.getElementById(`segment-${activeSegmentId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [activeSegmentId, playback.playing]);

    const markedIds = useMemo(() => new Set((marks ?? []).map(at => {
        const i = segments.findIndex((s, k) => at >= s.timestamp && at < (s.endTime ?? segments[k + 1]?.timestamp ?? Infinity));
        return i >= 0 ? segments[i].id : [...segments].reverse().find(s => s.timestamp <= at)?.id;
    }).filter(Boolean) as string[]), [marks, segments]);

    // Bring the current find match into view.
    useEffect(() => {
        const id = find?.current?.segmentId;
        if (!id) return;
        const index = segments.findIndex(s => s.id === id);
        if (index < 0) return;
        if (segments.length >= VIRTUALIZATION_THRESHOLD) virtualizer.scrollToIndex(index, { align: 'center' });
        requestAnimationFrame(() => document.getElementById(`segment-${id}`)?.scrollIntoView({ block: 'center' }));
    }, [find?.current?.segmentId, find?.current?.occurrence]); // eslint-disable-line react-hooks/exhaustive-deps

    // Use simple rendering for small lists, virtualization for large lists
    const useVirtualization = segments.length >= VIRTUALIZATION_THRESHOLD;

    return (
        <div ref={scrollRef} className="tetro-transcript-scroll flex flex-col h-full overflow-y-auto px-4 py-2">
            {/* Content - add padding when recording to prevent overlap */}
            <div>
            {segments.length === 0 ? (
                // Empty state
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="tetro-transcript-empty text-center text-gray-500 mt-8"
                >
                    {isRecording ? (
                        <>
                            <div className="tetro-ready tetro-listening" data-paused={isPaused || undefined}>
                                <span className="tetro-listening-dot" aria-hidden="true" />
                                <p className="tetro-ready-title">{isPaused ? 'Recording paused' : 'Listening…'}</p>
                                <p className="tetro-ready-sub">{isPaused ? 'Press Resume to keep recording.' : 'Words appear here as people speak.'}</p>
                            </div>
                        </>
                    ) : (
                        <>{emptyState ?? <div className="tetro-ready">
                            <p className="tetro-ready-title">Ready to record</p>
                            <p className="tetro-ready-sub">Press Record below. The transcript appears here as people talk.</p>
                        </div>}</>
                    )}
                </motion.div>
            ) : useVirtualization ? (
                // Virtualized rendering for large lists
                <>
                    <div
                        style={{
                            height: virtualizer.getTotalSize(),
                            width: "100%",
                            position: "relative",
                        }}
                    >
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const segment = segments[virtualRow.index];
                            const isStreaming = streamingSegmentId === segment.id;

                            return (
                                <div
                                    key={segment.id}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    {speakerLabels && segment.speaker && segment.speaker !== segments[virtualRow.index - 1]?.speaker && <SpeakerTag name={segment.speaker} meetingId={speakerLabels.meetingId} onRenamed={speakerLabels.onRenamed} />}
                                    <TranscriptSegment
                                        id={segment.id}
                                        timestamp={segment.timestamp}
                                        text={getDisplayText(segment)}
                                        confidence={segment.confidence}
                                        isStreaming={isStreaming}
                                        showConfidence={showConfidence}
                                        isActive={segment.id === activeSegmentId}
                                        onSeek={playback.available ? playback.seek : undefined}
                                        highlight={find?.query}
                                        currentOccurrence={find?.current?.segmentId === segment.id ? find.current.occurrence : undefined}
                                        onEdit={onEditSegment}
                                        edited={!!editedLines && segment.id in editedLines}
                                        needsReview={editedLines?.[segment.id]}
                                        isMarked={markedIds.has(segment.id)}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* Infinite scroll trigger and loading indicator */}
                    {(hasMore || isLoadingMore) && !isRecording && segments.length > 0 && (
                        <div ref={loadMoreTriggerRef} className="flex justify-center items-center py-4 mt-2">
                            {isLoadingMore ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                                    <span className="text-sm">Loading more...</span>
                                </div>
                            ) : hasMore && totalCount > 0 ? (
                                <span className="text-sm text-gray-400">
                                    Showing {loadedCount} of {totalCount} segments
                                </span>
                            ) : null}
                        </div>
                    )}

                    {/* Listening indicator when recording */}
                    {!isStopping && isRecording && !isPaused && !isProcessing && segments.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 mt-4 text-gray-500"
                        >
                            <div className="w-2 h-2 bg-[var(--tetro-accent)] rounded-full animate-pulse"></div>
                            <span className="text-sm">Listening...</span>
                        </motion.div>
                    )}
                </>
            ) : (
                // Simple rendering for small lists (better animations)
                <>
                    <div className="space-y-1">
                        {segments.map((segment, segmentIndex) => {
                            const isStreaming = streamingSegmentId === segment.id;

                            return (
                                <motion.div
                                    key={segment.id}
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.15 }}
                                >
                                    {speakerLabels && segment.speaker && segment.speaker !== segments[segmentIndex - 1]?.speaker && <SpeakerTag name={segment.speaker} meetingId={speakerLabels.meetingId} onRenamed={speakerLabels.onRenamed} />}
                                    <TranscriptSegment
                                        id={segment.id}
                                        timestamp={segment.timestamp}
                                        text={getDisplayText(segment)}
                                        confidence={segment.confidence}
                                        isStreaming={isStreaming}
                                        showConfidence={showConfidence}
                                        isActive={segment.id === activeSegmentId}
                                        onSeek={playback.available ? playback.seek : undefined}
                                        highlight={find?.query}
                                        currentOccurrence={find?.current?.segmentId === segment.id ? find.current.occurrence : undefined}
                                        onEdit={onEditSegment}
                                        edited={!!editedLines && segment.id in editedLines}
                                        needsReview={editedLines?.[segment.id]}
                                        isMarked={markedIds.has(segment.id)}
                                    />
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* Infinite scroll trigger (for small lists that grow) */}
                    {(hasMore || isLoadingMore) && !isRecording && segments.length > 0 && (
                        <div ref={loadMoreTriggerRef} className="flex justify-center items-center py-4 mt-2">
                            {isLoadingMore ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                                    <span className="text-sm">Loading more...</span>
                                </div>
                            ) : hasMore && totalCount > 0 ? (
                                <span className="text-sm text-gray-400">
                                    Showing {loadedCount} of {totalCount} segments
                                </span>
                            ) : null}
                        </div>
                    )}

                    {/* Listening indicator when recording */}
                    {!isStopping && isRecording && !isPaused && !isProcessing && segments.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 mt-4 text-gray-500"
                        >
                            <div className="w-2 h-2 bg-[var(--tetro-accent)] rounded-full animate-pulse"></div>
                            <span className="text-sm">Listening...</span>
                        </motion.div>
                    )}
                </>
            )}
            </div>
        </div>
    );
};
