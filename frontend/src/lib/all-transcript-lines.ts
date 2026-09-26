export type TranscriptPage<T> = { transcripts: T[]; total_count: number; has_more?: boolean };

/** Fetch only when whole-recording search/editing needs it; keep the normal view paginated. */
export async function allTranscriptLines<T>(fetchPage: (offset: number, limit: number) => Promise<TranscriptPage<T>>, cancelled = () => false): Promise<T[]> {
  const lines: T[] = [];
  for (;;) {
    if (cancelled()) throw new Error('Search cancelled');
    const page = await fetchPage(lines.length, 500);
    if (cancelled()) throw new Error('Search cancelled');
    lines.push(...page.transcripts);
    if (lines.length >= page.total_count || page.has_more === false) return lines;
    if (!page.transcripts.length) throw new Error('Part of the transcript could not be loaded. Please try again.');
  }
}
