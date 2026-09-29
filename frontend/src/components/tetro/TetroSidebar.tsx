'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { textUpdated, TRASH_UPDATED } from '@/lib/meeting-edits';
import { BookOpen, CircleHelp, History, ListChecks, X, Info, Moon, Pencil, Search, Settings, Sun, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useSidebar, type CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Highlighted } from '@/components/tetro/TranscriptFind';
import { TetroLiveBrand } from '@/components/tetro/TetroBrand';

export default function TetroSidebar() {
  const { isCollapsed, toggleCollapse, sidebarWidth, setSidebarWidth, meetings, currentMeeting, refetchMeetings, searchTranscripts, searchResults, isSearching, libraryError } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();
  const { openImportDialog } = useImportDialog();
  const { isRecording } = useRecordingState();
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const blurTimer = useRef<number>();
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  useEffect(() => { try { localStorage.removeItem('tetro.recentSearches'); } catch { /* Storage unavailable. */ } }, []);
  const saveRecent = (list: string[]) => { setRecentSearches(list); };
  const rememberSearch = (q: string) => {
    const t = q.trim();
    if (t.length < 2) return;
    saveRecent([t, ...recentSearches.filter(r => r.toLowerCase() !== t.toLowerCase())].slice(0, 6));
  };
  // A search that sits unchanged for a moment counts as used.
  useEffect(() => { if (query.trim().length < 2) return; const t = setTimeout(() => rememberSearch(query), 2000); return () => clearTimeout(t); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edit, setEdit] = useState<CurrentMeeting | null>(null);
  const [remove, setRemove] = useState<CurrentMeeting | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const library = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [track, setTrack] = useState({ top: 200, bottom: 500, visible: false });

  useEffect(() => {
    const timeout = setTimeout(() => { void searchTranscripts(query); }, 180);
    return () => clearTimeout(timeout);
    // searchTranscripts is supplied by the legacy context and changes on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    const nav = library.current, shell = sidebar.current;
    if (!nav || !shell) return;
    const measure = () => {
      const a = nav.getBoundingClientRect(), b = shell.getBoundingClientRect();
      setTrack({ top: a.top - b.top, bottom: a.bottom - b.top, visible: nav.scrollHeight > nav.clientHeight + 1 });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav); observer.observe(shell);
    measure();
    return () => observer.disconnect();
  }, [isCollapsed, meetings.length, searchResults.length, query]);

  const resize = (event: React.PointerEvent) => {
    if (!drag.current) return;
    setSidebarWidth(Math.min(window.innerWidth - 480, drag.current.width + event.clientX - drag.current.x));
  };
  const resizeHandle = {
    onPointerDown: (event: React.PointerEvent) => {
      event.preventDefault(); drag.current = { x: event.clientX, width: sidebarWidth };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: resize,
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { if (drag.current) setSidebarWidth(drag.current.width); drag.current = null; },
    onDoubleClick: () => setSidebarWidth(232),
  };
  const saveTitle = async () => {
    if (!edit || !title.trim()) return;
    setBusy(true);
    try { await invoke('api_save_meeting_title', { meetingId: edit.id, title: title.trim() }); await refetchMeetings(); setEdit(null); }
    catch (error) { toast.error(`Could not rename meeting: ${String(error)}`); }
    finally { setBusy(false); }
  };
  const [removeParts, setRemoveParts] = useState({ transcript: true, summary: true, audio: true });
  const deleteMeeting = async () => {
    if (!remove) return;
    setBusy(true);
    try { await invoke('api_move_to_trash', { meetingId: remove.id, parts: removeParts }); textUpdated(remove.id, undefined, removeParts.audio); window.dispatchEvent(new Event(TRASH_UPDATED)); if (currentMeeting?.id === remove.id && Object.values(removeParts).every(Boolean)) router.push('/'); await refetchMeetings(); setRemove(null); }
    catch (error) { toast.error(`Could not delete meeting: ${String(error)}`); }
    finally { setBusy(false); }
  };
  const visibleMeetings = query.trim() ? searchResults : meetings;
  if (isCollapsed) return null;

  return <aside ref={sidebar} className="tetro-sidebar" style={{ width: sidebarWidth }}>
    <div className="tetro-brand"><Link href="/" aria-label="Tetro home" className="tetro-brand-home"><TetroLiveBrand /></Link></div>
    <div className="tetro-navigation">
      <div className="tetro-new-row">
        <button className="tetro-new" data-live={isRecording || undefined} onClick={() => { router.push('/'); }}><span className="tetro-glyph-rec" aria-hidden="true" />{isRecording ? 'Recording' : 'New recording'}</button>
        <button className="tetro-new tetro-new-import" onClick={() => openImportDialog()} aria-label="Import audio" title="Import an audio or video file"><Upload /></button>
      </div>
      <button className={pathname === '/templates' ? 'selected' : ''} onClick={() => router.push('/templates')}><BookOpen />Templates</button>
      <button className={pathname === '/action-items' ? 'selected' : ''} onClick={() => router.push('/action-items')}><ListChecks />Action items</button>
      <button className={pathname === '/trash' ? 'selected' : ''} onClick={() => router.push('/trash')}><Trash2 />Trash</button>
    </div>
    <div className="tetro-search-wrap">
      <label className="tetro-search"><Search /><input ref={searchInput} aria-label="Search meetings, summaries and transcripts" placeholder="Search meetings…" value={query}
        onChange={e => setQuery(e.target.value)} onFocus={() => { window.clearTimeout(blurTimer.current); setSearchFocused(true); }} onBlur={() => { blurTimer.current = window.setTimeout(() => setSearchFocused(false), 150); }} onMouseDown={() => setSearchFocused(true)}
        onKeyDown={e => { if (e.key === 'Enter') rememberSearch(query); if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }} />
        {query && <button type="button" className="tetro-search-clear" onMouseDown={e => e.preventDefault()} onClick={() => { setQuery(''); searchInput.current?.focus(); setSearchFocused(true); }} aria-label="Clear search" title="Clear search"><X /></button>}
      </label>
      {searchFocused && !query && recentSearches.length > 0 && <div className="tetro-recent" role="listbox" aria-label="Recent searches">
        <div className="tetro-recent-head"><span>Recent searches</span><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => saveRecent([])}>Clear</button></div>
        {recentSearches.map(r => <button key={r} type="button" role="option" aria-selected={false} onMouseDown={e => e.preventDefault()} onClick={() => setQuery(r)}><History aria-hidden="true" />{r}</button>)}
      </div>}
    </div>
    {query && <div className="tetro-library-label">{isSearching ? 'Searching…' : 'Search results'}</div>}
    {libraryError && <p role="alert" className="tetro-library-error">{libraryError} <button className="tetro-link" onClick={() => void refetchMeetings()}>Retry</button></p>}
    <nav ref={library} className="tetro-library" aria-label="Meetings">
      {visibleMeetings.map((meeting, index) => <Fragment key={meeting.id}>{!query.trim() && dayLabel(meeting, visibleMeetings[index - 1]) && <div className="tetro-day-label">{dayLabel(meeting, visibleMeetings[index - 1])}</div>}<div className={`tetro-meeting ${currentMeeting?.id === meeting.id && pathname === '/meeting-details' ? 'selected' : ''}`}>
        <button className="tetro-meeting-open" onClick={() => { if (query.trim()) rememberSearch(query); router.push(`/meeting-details?id=${encodeURIComponent(meeting.id)}${query.trim() && 'source' in meeting && meeting.source !== 'title' ? `&q=${encodeURIComponent(query.trim())}` : ''}`); }}><span title={meeting.title}>{meeting.title}</span>{'created_at' in meeting && meeting.created_at ? <small>{meetingMeta(meeting as CurrentMeeting, !!query.trim())}</small> : null}{'source' in meeting && meeting.source && meeting.source !== 'title' && <small className="tetro-search-where">{meeting.source === 'notes' ? 'In summary' : `In transcript${typeof meeting.audio_time === 'number' ? ` at ${Math.floor(meeting.audio_time / 60).toString().padStart(2, '0')}:${Math.floor(meeting.audio_time % 60).toString().padStart(2, '0')}` : ''}`}</small>}{'matchContext' in meeting && meeting.matchContext && <small className="tetro-search-match"><Highlighted text={meeting.matchContext} query={query} /></small>}</button>
        <div className="tetro-meeting-actions"><button title={`Rename ${meeting.title}`} aria-label={`Rename ${meeting.title}`} onClick={() => { setEdit(meeting); setTitle(meeting.title); }}><Pencil /></button><button title={`Delete ${meeting.title}`} aria-label={`Delete ${meeting.title}`} onClick={() => { setRemoveParts({ transcript: true, summary: true, audio: true }); setRemove(meeting); }}><Trash2 /></button></div>
      </div></Fragment>)}
      {!visibleMeetings.length && <p className="tetro-library-empty">{query ? (isSearching ? 'Searching…' : `Nothing matches “${query.trim()}” in titles, summaries or transcripts.`) : 'Your recordings and imports will appear here.'}</p>}
    </nav>
    <div className="tetro-sidebar-bottom" role="group" aria-label="App">
      <button className={`tetro-dock-main ${pathname === '/settings' ? 'selected' : ''}`} onClick={() => router.push('/settings')} aria-label="Settings" title="Settings"><Settings /><span>Settings</span></button>
      <span className="tetro-dock-sep" aria-hidden="true" />
      <button className="tetro-dock-icon" onClick={() => window.dispatchEvent(new CustomEvent('tetro:about'))} aria-label="About Tetro" title="About and privacy"><Info /></button>
      <button className={`tetro-dock-icon ${pathname === '/help' ? 'selected' : ''}`} onClick={() => router.push('/help')} aria-label="Tutorial" title="Tutorial"><CircleHelp /></button>
      <button className="tetro-dock-icon" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
    </div>
    <div className="tetro-sidebar-resizer">
      <div {...resizeHandle} className="tetro-resize-hit" style={{ top: 0, height: track.visible ? track.top : '100%' }} />
      {track.visible && <div {...resizeHandle} className="tetro-resize-hit" style={{ top: track.bottom, bottom: 0 }} />}
      <div {...resizeHandle} role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={420} aria-valuenow={sidebarWidth} tabIndex={0} className="tetro-resize-grip" onKeyDown={event => { const step = event.shiftKey ? 24 : 8; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSidebarWidth(sidebarWidth + (event.key === 'ArrowLeft' ? -step : step)); } if (event.key === 'Enter') toggleCollapse(); if (event.key === 'Home') setSidebarWidth(200); if (event.key === 'End') setSidebarWidth(420); }} />
    </div>

    <Dialog open={!!edit} onOpenChange={open => { if (!open && !busy) setEdit(null); }}><DialogContent><DialogTitle>Rename meeting</DialogTitle><DialogDescription>Change the title shown in your library.</DialogDescription><form onSubmit={e => { e.preventDefault(); void saveTitle(); }} className="tetro-dialog-form"><input aria-label="Meeting title" value={title} onChange={e => setTitle(e.target.value)} autoFocus /><button className="tetro-primary" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save title'}</button></form></DialogContent></Dialog>
    {remove && <Dialog open onOpenChange={open => { if (!open && !busy) setRemove(null); }}><DialogContent>
      <DialogTitle>Move to Trash?</DialogTitle><DialogDescription>“{remove?.title}” can be restored from Trash.</DialogDescription>
      <details className="tetro-delete-options"><summary>Choose what to remove</summary>
        {(['transcript', 'summary', 'audio'] as const).map(part => <label key={part}><input type="checkbox" checked={removeParts[part]} disabled={busy} onChange={e => setRemoveParts(parts => ({ ...parts, [part]: e.target.checked }))} />{part === 'summary' ? 'Summary and its tasks' : part === 'transcript' ? 'Transcript' : 'Audio recording'}</label>)}
        <small>{Object.values(removeParts).every(Boolean) ? 'The entire meeting moves to Trash.' : 'The meeting stays in your library with the items you keep. Important moments stay attached to the recording.'}</small>
      </details>
      <div className="tetro-dialog-actions"><button onClick={() => setRemove(null)} disabled={busy}>Cancel</button><button className="tetro-danger" onClick={() => void deleteMeeting()} disabled={busy || !Object.values(removeParts).some(Boolean)}>{busy ? 'Moving…' : 'Move to Trash'}</button></div>
    </DialogContent></Dialog>}
  </aside>;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** "Today", "Yesterday", a weekday within the last week, else "Sep 15" (plus the year if not this year). */
function dayName(date: Date) {
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** A day heading above the first meeting of each day. */
function dayLabel(meeting: object, previous?: object) {
  const created = (m?: object) => (m && 'created_at' in m && typeof m.created_at === 'string' ? m.created_at : null);
  const at = created(meeting);
  if (!at) return null;
  const day = new Date(at);
  const prev = created(previous);
  if (prev && dayKey(new Date(prev)) === dayKey(day)) return null;
  return dayName(day);
}

/** "14:05 · 42 min". Search results have no day headings, so they carry the day too. */
function meetingMeta(meeting: CurrentMeeting, withDay: boolean) {
  const at = new Date(meeting.created_at as string);
  const parts = [withDay ? `${dayName(at)}, ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })];
  const d = meeting.duration_seconds;
  if (d && d > 0) parts.push(d < 60 ? '<1 min' : d < 3600 ? `${Math.round(d / 60)} min` : `${Math.floor(d / 3600)} h ${Math.round((d % 3600) / 60)} min`);
  return parts.join(' · ');
}
