import { useState, useCallback, useRef, useEffect } from 'react';
import { MeetingSummary, Summary, Transcript } from '@/types';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { CurrentMeeting, useSidebar } from '@/components/Sidebar/SidebarProvider';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { hasVisibleSummaryContent } from '@/lib/summary-content';
import { parseSummaryContent } from '@/lib/summary-content';
import { correctName, nameCorrection, TEXT_UPDATED } from '@/lib/meeting-edits';

interface UseMeetingDataProps {
  meeting: any;
  summaryData: MeetingSummary | null;
  onMeetingUpdated?: () => Promise<void>;
}

export function useMeetingData({ meeting, summaryData, onMeetingUpdated }: UseMeetingDataProps) {
  // State
  // Use prop directly since summary generation fetches transcripts independently
  const transcripts = meeting.transcripts;
  const [meetingTitle, setMeetingTitle] = useState(meeting.title || 'New recording');
  const [aiSummary, setAiSummary] = useState<MeetingSummary | null>(summaryData);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummaryDirty, setIsSummaryDirty] = useState(false);

  // Ref for BlockNoteSummaryView
  const blockNoteSummaryRef = useRef<BlockNoteSummaryViewRef>(null);
  const savedSummary = useRef(summaryData); savedSummary.current = aiSummary;

  useEffect(() => {
    let cancelled = false;
    const update = async (event: Event) => {
      if ((event as CustomEvent).detail.meetingId !== meeting.id || blockNoteSummaryRef.current?.isDirty) return;
      try {
        const response = await invokeTauri<{ data: unknown }>('api_get_summary', { meetingId: meeting.id });
        if (!cancelled) setAiSummary(parseSummaryContent(response.data));
      } catch (e) { toast.error('Could not refresh the notes', { description: String(e) }); }
    };
    window.addEventListener(TEXT_UPDATED, update);
    return () => { cancelled = true; window.removeEventListener(TEXT_UPDATED, update); };
  }, [meeting.id]);

  // Sidebar context
  const { setCurrentMeeting, setMeetings, meetings: sidebarMeetings } = useSidebar();
  const libraryTitle = sidebarMeetings.find(item => item.id === meeting.id)?.title;

  useEffect(() => {
    setMeetingTitle(libraryTitle || meeting.title || 'New recording');
  }, [meeting.id, meeting.title, libraryTitle]);

  // Sync aiSummary state when summaryData prop changes (fixes display of fetched summaries)
  useEffect(() => {
    console.log('[useMeetingData] Syncing summary data from prop:', summaryData ? 'present' : 'null');
    setAiSummary(summaryData);
  }, [summaryData]); // Only trigger when parent prop changes, not when aiSummary changes

  const handleSummaryChange = useCallback((newSummary: Summary) => {
    setAiSummary(newSummary);
  }, []);



  const handleSaveSummary = useCallback(async (summary: MeetingSummary) => {
    if (!hasVisibleSummaryContent(summary)) {
      throw new Error('Summary contains no visible content to save.');
    }

    const formattedSummary = 'markdown' in summary || 'summary_json' in summary
      ? summary
      : { MeetingName: meetingTitle, ...summary };
    await invokeTauri('api_save_meeting_summary', {
      meetingId: meeting.id,
      summary: formattedSummary,
    });
    const before = (savedSummary.current as { markdown?: string } | null)?.markdown;
    const after = (formattedSummary as { markdown?: string }).markdown;
    const change = before && after ? nameCorrection(before, after) : null;
    if (change) await correctName(meeting.id, change.from, change.to);
    if (change) {
      const response = await invokeTauri<{ data: unknown }>('api_get_summary', { meetingId: meeting.id });
      setAiSummary(parseSummaryContent(response.data));
    } else setAiSummary(formattedSummary);
  }, [meeting.id, meetingTitle]);

  const saveAllChanges = useCallback(async () => {
    setIsSaving(true);
    try {
      // Save BlockNote editor changes if dirty
      if (blockNoteSummaryRef.current?.isDirty) {
        console.log('💾 Saving BlockNote editor changes...');
        await blockNoteSummaryRef.current.saveSummary();
      } else if (aiSummary) {
        await handleSaveSummary(aiSummary);
      }

    } catch (error) {
      console.error('Failed to save changes:', error);
      toast.error("Failed to save changes", { description: String(error) });
    } finally {
      setIsSaving(false);
    }
  }, [aiSummary, handleSaveSummary]);

  // Update meeting title from external source (e.g., AI summary)
  const updateMeetingTitle = useCallback((newTitle: string) => {
    console.log('📝 Updating meeting title to:', newTitle);
    setMeetingTitle(newTitle);
    const updatedMeetings = sidebarMeetings.map((m: CurrentMeeting) =>
      m.id === meeting.id ? { ...m, title: newTitle } : m
    );
    setMeetings(updatedMeetings);
    setCurrentMeeting({ ...sidebarMeetings.find(m => m.id === meeting.id), id: meeting.id, title: newTitle });
  }, [meeting.id, sidebarMeetings, setMeetings, setCurrentMeeting]);

  return {
    // State
    transcripts,
    meetingTitle,
    aiSummary,
    isSaving,
    isSummaryDirty,
    blockNoteSummaryRef,

    // Setters
    setMeetingTitle,
    setAiSummary,
    setIsSummaryDirty,

    // Handlers
    handleSummaryChange,
    handleSaveSummary,
    saveAllChanges,
    updateMeetingTitle,
  };
}
