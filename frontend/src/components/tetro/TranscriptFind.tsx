'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

export type FindMatch = { segmentId: string; occurrence: number };
export type FindState = { query: string; current: FindMatch | null };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const findPattern = (query: string) => query.trim() ? new RegExp(escape(query.trim()), 'giu') : null;

/** Renders text with every match of `query` marked; the current occurrence gets `is-current`. */
export function Highlighted({ text, query, current }: { text: string; query?: string; current?: number }) {
  const pattern = query ? findPattern(query) : null;
  if (!pattern) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0, n = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    parts.push(<Fragment key={`t${at}`}>{text.slice(last, at)}</Fragment>);
    parts.push(<mark key={`m${at}`} className={n === current ? 'tetro-find-hit is-current' : 'tetro-find-hit'}>{m[0]}</mark>);
    last = at + m[0].length; n++;
  }
  parts.push(<Fragment key="end">{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}

/** ⌘F find state for a list of transcript lines. */
export function useTranscriptFind(segments: { id: string; text: string }[], enabled = true) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const matches = useMemo<FindMatch[]>(() => {
    const pattern = findPattern(query);
    if (!pattern) return [];
    return segments.flatMap(s => Array.from(s.text.matchAll(pattern), (_, occurrence) => ({ segmentId: s.id, occurrence })));
  }, [segments, query]);

  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => { if (index >= matches.length) setIndex(0); }, [matches.length, index]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  const step = useCallback((by: number) => setIndex(i => matches.length ? (i + by + matches.length) % matches.length : 0), [matches.length]);
  const close = useCallback(() => { setOpen(false); setQuery(''); }, []);
  const state: FindState = { query: open ? query : '', current: open ? matches[index] ?? null : null };
  return { open, setOpen, query, setQuery, matches, index, step, close, state };
}

export function FindBar({ find, partial, loading, error }: { find: ReturnType<typeof useTranscriptFind>; partial?: boolean; loading?: boolean; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (find.open) input.current?.select(); }, [find.open]);
  if (!find.open) return null;
  const count = find.matches.length;
  return <div className="tetro-find" role="search">
    <input ref={input} autoFocus value={find.query} onChange={e => find.setQuery(e.target.value)} placeholder="Find in transcript" aria-label="Find in transcript"
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); find.step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') find.close(); }} />
    <span className="tetro-find-count" aria-live="polite">{loading ? 'Searching all lines…' : error ? 'Search incomplete' : find.query.trim() ? (count ? `${find.index + 1} of ${count}` : 'No matches') : ''}{partial && find.query.trim() ? ' · loaded lines' : ''}</span>
    <button className="tetro-icon" onClick={() => find.step(-1)} disabled={!count} aria-label="Previous match" title="Previous (⇧↩)"><ChevronUp /></button>
    <button className="tetro-icon" onClick={() => find.step(1)} disabled={!count} aria-label="Next match" title="Next (↩)"><ChevronDown /></button>
    <button className="tetro-icon" onClick={find.close} aria-label="Close find" title="Close (Esc)"><X /></button>
  </div>;
}
