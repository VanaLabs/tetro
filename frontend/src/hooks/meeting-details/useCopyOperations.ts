import { useCallback, RefObject, useState } from 'react';
import { MeetingSummary, Transcript } from '@/types';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { toast } from 'sonner';

import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { hasVisibleSummaryContent } from '@/lib/summary-content';

const clock = (seconds: number) => {
  const s = Math.floor(seconds);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const minutes = (seconds: number) => seconds < 60 ? 'under 1 min' : seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;

/** Notes with one title and a readable date line (no internal ids). */
function withHeading(notes: string, title: string, meeting: any, durationSeconds?: number) {
  const when = new Date(meeting.created_at);
  const line = `*${when.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}, ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}${durationSeconds ? ` · ${minutes(durationSeconds)}` : ''}*`;
  const body = notes.trim();
  // Notes written by the model usually start with their own "# Title".
  return /^#\s/.test(body) ? body.replace(/^(#[^\n]*\n)/, `$1\n${line}\n`) : `# ${title}\n\n${line}\n\n${body}`;
}

function getMarkdownExportFilename(title: string): string {
  const safeTitle = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .slice(0, 120)
    .trim();

  return `${safeTitle || 'meeting-summary'}.md`;
}

interface UseCopyOperationsProps {
  meeting: any;
  transcripts: Transcript[];
  meetingTitle: string;
  aiSummary: MeetingSummary | null;
  blockNoteSummaryRef: RefObject<BlockNoteSummaryViewRef>;
}

export function useCopyOperations({
  meeting,
  transcripts,
  meetingTitle,
  aiSummary,
  blockNoteSummaryRef,
}: UseCopyOperationsProps) {
  const [isExporting, setIsExporting] = useState(false);

  // Helper function to fetch ALL transcripts for copying (not just paginated data)
  const fetchAllTranscripts = useCallback(async (meetingId: string): Promise<Transcript[]> => {
    try {
      console.log('📊 Fetching all transcripts for copying:', meetingId);

      // First, get total count by fetching first page
      const firstPage = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: 1,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      const totalCount = firstPage.total_count;
      console.log(`📊 Total transcripts in database: ${totalCount}`);

      if (totalCount === 0) {
        return [];
      }

      // Fetch all transcripts in one call
      const allData = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: totalCount,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      console.log(`✅ Fetched ${allData.transcripts.length} transcripts from database for copying`);
      return allData.transcripts;
    } catch (error) {
      console.error('❌ Error fetching all transcripts:', error);
      toast.error('Failed to fetch transcripts for copying');
      return [];
    }
  }, []);

  // Copy transcript to clipboard
  const handleCopyTranscript = useCallback(async () => {
    // CHANGE: Fetch ALL transcripts from database, not from pagination state
    console.log('📊 Fetching all transcripts for copying...');
    const allTranscripts = await fetchAllTranscripts(meeting.id);

    if (!allTranscripts.length) {
      const error_msg = 'No transcripts available to copy';
      console.log(error_msg);
      toast.error(error_msg);
      return;
    }

    console.log(`✅ Copying ${allTranscripts.length} transcripts to clipboard`);

    // Format timestamps as recording-relative [MM:SS] instead of wall-clock time
    const formatTime = (seconds: number | undefined, fallbackTimestamp: string): string => {
      if (seconds === undefined) {
        // For old transcripts without audio_start_time, use wall-clock time
        return fallbackTimestamp;
      }
      const totalSecs = Math.floor(seconds);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
    };

    const header = `# ${meetingTitle ?? meeting.title}: transcript\n\n`;
    const date = `*${new Date(meeting.created_at).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}*\n\n`;
    const fullTranscript = allTranscripts
      .map(t => `${formatTime(t.audio_start_time, t.timestamp)} ${t.text}  `)
      .join('\n');

    await navigator.clipboard.writeText(header + date + fullTranscript);
    toast.success("Transcript copied to clipboard");

  }, [meeting, meetingTitle, fetchAllTranscripts]);

  const getFullSummaryMarkdown = useCallback(async (raw = false): Promise<string> => {
    if (!hasVisibleSummaryContent(aiSummary)) return '';

    let summaryMarkdown = '';

    // Prefer the live BlockNote editor so unsaved edits are included.
    if (blockNoteSummaryRef.current?.getMarkdown) {
      summaryMarkdown = await blockNoteSummaryRef.current.getMarkdown();
    }

    // Fall back to the stored Markdown when the editor ref is unavailable.
    if (!summaryMarkdown && aiSummary && typeof aiSummary.markdown === 'string') {
      summaryMarkdown = aiSummary.markdown;
    }

    // Support the legacy summary shape as a final fallback.
    if (!summaryMarkdown && aiSummary) {
      summaryMarkdown = Object.entries(aiSummary)
        .filter(([key]) => !['markdown', 'summary_json', '_section_order', 'MeetingName'].includes(key))
        .map(([, section]) => {
          if (section && typeof section === 'object' && 'title' in section && 'blocks' in section) {
            const sectionTitle = `## ${section.title}\n\n`;
            const sectionContent = (section.blocks as any[])
              .map((block) => `- ${block.content}`)
              .join('\n');
            return sectionTitle + sectionContent;
          }
          return '';
        })
        .filter((section) => section.trim())
        .join('\n\n');
    }

    if (!summaryMarkdown.trim()) return '';

    return raw ? summaryMarkdown : withHeading(summaryMarkdown, meetingTitle, meeting);
  }, [aiSummary, meetingTitle, meeting, blockNoteSummaryRef]);

  // Copy summary to clipboard
  const handleCopySummary = useCallback(async () => {
    if (!hasVisibleSummaryContent(aiSummary)) {
      toast.error('No summary content available to copy');
      return;
    }
    try {
      let summaryMarkdown = '';

      console.log('🔍 Copy Summary - Starting...');

      // Try to get markdown from BlockNote editor first
      if (blockNoteSummaryRef.current?.getMarkdown) {
        console.log('📝 Trying to get markdown from ref...');
        summaryMarkdown = await blockNoteSummaryRef.current.getMarkdown();
        console.log('📝 Got markdown from ref, length:', summaryMarkdown.length);
      }

      // Fallback: Check if aiSummary has markdown property
      if (!summaryMarkdown && aiSummary && typeof aiSummary.markdown === 'string') {
        console.log('📝 Using markdown from aiSummary');
        summaryMarkdown = aiSummary.markdown;
        console.log('📝 Markdown from aiSummary, length:', summaryMarkdown.length);
      }

      // Fallback: Check for legacy format
      if (!summaryMarkdown && aiSummary) {
        console.log('📝 Converting legacy format to markdown');
        const sections = Object.entries(aiSummary)
          .filter(([key]) => {
            // Skip non-section keys
            return key !== 'markdown' && key !== 'summary_json' && key !== '_section_order' && key !== 'MeetingName';
          })
          .map(([, section]) => {
            if (section && typeof section === 'object' && 'title' in section && 'blocks' in section) {
              const sectionTitle = `## ${section.title}\n\n`;
              const sectionContent = section.blocks
                .map((block: any) => `- ${block.content}`)
                .join('\n');
              return sectionTitle + sectionContent;
            }
            return '';
          })
          .filter(s => s.trim())
          .join('\n\n');
        summaryMarkdown = sections;
        console.log('📝 Converted legacy format, length:', summaryMarkdown.length);
      }

      // If still no summary content, show message
      if (!summaryMarkdown.trim()) {
        console.error('❌ No summary content available to copy');
        toast.error('No summary content available to copy');
        return;
      }

      // Build metadata header
      const header = `# Meeting Summary: ${meetingTitle}\n\n`;
      const metadata = `**Meeting ID:** ${meeting.id}\n**Date:** ${new Date(meeting.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}\n**Copied on:** ${new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}\n\n---\n\n`;

      const fullMarkdown = header + metadata + summaryMarkdown;
      await navigator.clipboard.writeText(fullMarkdown);

      console.log('✅ Successfully copied to clipboard!');
      toast.success("Summary copied to clipboard");

    } catch (error) {
      console.error('❌ Failed to copy summary:', error);
      toast.error("Failed to copy summary");
    }
  }, [aiSummary, meetingTitle, meeting, blockNoteSummaryRef]);

  /** Saves a Markdown file: front matter (for Obsidian and similar), notes, marked moments, optional transcript. */
  const handleExportSummary = useCallback(async (includeTranscript = false, format: 'md' | 'pdf' = 'md') => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const notes = await getFullSummaryMarkdown(true);
      if (!notes.trim()) { toast.error('There’s no summary to export yet'); return; }
      const all = await fetchAllTranscripts(meeting.id);
      const duration = all.reduce((m, t) => Math.max(m, t.audio_end_time ?? 0), 0);
      const marks = await invokeTauri<{ at_seconds: number }[]>('api_get_meeting_marks', { meetingId: meeting.id }).catch(() => []);
      const when = new Date(meeting.created_at);
      const parts = [
        ['---', `title: "${meetingTitle.replace(/"/g, '\\"')}"`, `date: ${when.toISOString()}`, ...(duration ? [`duration: ${minutes(duration)}`] : []), 'source: Tetro', '---'].join('\n'),
        withHeading(notes, meetingTitle, meeting, duration),
      ];
      if (marks.length) {
        parts.push('## Marked moments\n\n' + marks.map(m => {
          const around = all.filter(t => (t.audio_end_time ?? 0) >= m.at_seconds - 30 && (t.audio_start_time ?? 0) <= m.at_seconds + 20).map(t => t.text.trim()).join(' ');
          return `- **${clock(m.at_seconds)}** ${around}`.trim();
        }).join('\n'));
      }
      if (includeTranscript && all.length) {
        parts.push('## Transcript\n\n' + all.map(t => `**${t.audio_start_time !== undefined ? clock(t.audio_start_time) : t.timestamp}** ${t.text.trim()}`).join('\n\n'));
      }
      if (format === 'pdf') {
        const { printMeeting } = await import('@/lib/print-meeting');
        await printMeeting(parts.slice(1).join('\n\n'), meetingTitle);
        toast('Choose Save as PDF in the print window.');
        return;
      }
      const selectedPath = await save({ defaultPath: getMarkdownExportFilename(meetingTitle), filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!selectedPath) return;
      const exportPath = /\.md$/i.test(selectedPath) ? selectedPath : `${selectedPath}.md`;
      await invokeTauri('save_markdown_file', { filePath: exportPath, content: parts.join('\n\n') + '\n' });
      toast.success('Exported', { description: exportPath });
    } catch (error) {
      console.error('Failed to export summary:', error);
      toast.error('Couldn’t export the summary', { description: String(error) });
    } finally {
      setIsExporting(false);
    }
  }, [getFullSummaryMarkdown, fetchAllTranscripts, isExporting, meeting, meetingTitle]);

  return {
    handleCopyTranscript,
    handleCopySummary,
    handleExportSummary,
    isExporting,
  };
}
