'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState } from '@/contexts/RecordingStateContext';

export default function MainContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed, toggleCollapse, currentMeeting, meetings } = useSidebar();
  const { isRecording, isPaused } = useRecordingState();
  const pathname = usePathname();
  // ⌘\ (Ctrl+\ elsewhere) shows or hides the meeting list from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleCollapse(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCollapse]);
  const toggleLabel = isCollapsed ? 'Show meeting list' : 'Hide meeting list';
  const selected = meetings.find(meeting => meeting.id === currentMeeting?.id);
  const title = pathname === '/help' ? 'Tetro guide' : pathname === '/trash' ? 'Trash' : pathname === '/settings' ? 'Settings' : pathname === '/templates' ? 'Templates' : pathname === '/action-items' ? 'Action items' : pathname === '/' ? (isRecording ? 'Current recording' : 'New recording') : selected?.title || currentMeeting?.title || 'Meeting';
  return <main className="tetro-main">
    <button className={`tetro-edge-toggle ${isCollapsed ? 'is-collapsed' : ''}`} onClick={toggleCollapse} aria-label={toggleLabel} aria-expanded={!isCollapsed} title={`${toggleLabel} (⌘\\)`}>{isCollapsed ? <ChevronRight /> : <ChevronLeft />}</button>
    <header className="tetro-header"><h1 title={title}>{title}</h1>{selected?.created_at && pathname === '/meeting-details' && <time>{new Date(selected.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time>}<span className="tetro-header-spacer" /><div id="tetro-header-slot" className="tetro-header-slot" />{isRecording && <Link href="/" className="tetro-recording-status">{isPaused ? 'Paused' : 'Recording'}</Link>}{process.env.NEXT_PUBLIC_TETRO_DEV === '1' && <span className="tetro-dev-badge" title="Development app · separate test data · live frontend updates">Tetro Dev · live</span>}</header>
    <div className={`tetro-content ${pathname === '/help' ? 'tetro-content--help' : ''}`}>{children}</div>
  </main>;
}
