'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Columns2 } from 'lucide-react';
export type MeetingDetailsTab = 'transcript' | 'summary';
interface Props { transcript: ReactNode; summary: ReactNode; activeTab: MeetingDetailsTab; onTabChange: (tab: MeetingDetailsTab) => void }
const RATIO_KEY = 'tetro.transcriptPaneRatio';
export function MeetingDetailsSplitView({ transcript, summary, activeTab, onTabChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const [ratio, setRatio] = useState(.36);
  const [split, setSplit] = useState(true);
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    try { const raw = localStorage.getItem(RATIO_KEY); if (raw && Number(raw) >= .28 && Number(raw) <= .65) setRatio(Number(raw)); setSplit(localStorage.getItem('tetro.split') !== 'false'); } catch {}
    const media = matchMedia('(min-width: 768px)'); const update = () => setDesktop(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  const setWidth = (n: number) => { const width = Math.max(.28, Math.min(.65, n)); setRatio(width); try { localStorage.setItem(RATIO_KEY, String(width)); } catch {} };
  const both = desktop && split;
  // The view selector lives in the page header (see MainContent) so the sheets get the height.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById('tetro-header-slot')); }, []);
  const viewBar = <div className="tetro-workspace-bar">
        {!both && <div className="tetro-selector" role="tablist" aria-label="Meeting view">
          <button role="tab" id="tetro-transcript-tab" aria-selected={activeTab === 'transcript'} aria-controls="tetro-transcript" onClick={() => onTabChange('transcript')}>Transcript</button>
          <button role="tab" id="tetro-notes-tab" aria-selected={activeTab === 'summary'} aria-controls="tetro-notes" onClick={() => onTabChange('summary')}>Summary</button>
        </div>}
        {desktop && <button className="tetro-split-toggle" aria-pressed={split} onClick={() => { setSplit(!split); try { localStorage.setItem('tetro.split', String(!split)); } catch {} }} title={split ? 'Show one view at a time' : 'Show transcript and summary side by side'}><Columns2 />Side by side</button>}
      </div>;
  return <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
    {slot ? createPortal(viewBar, slot) : viewBar}
    <div ref={container} className="tetro-desk flex flex-1 min-h-0 min-w-0 overflow-hidden">
      <section id="tetro-transcript" className="tetro-sheet" role={both ? 'region' : 'tabpanel'} aria-label={both ? 'Transcript' : undefined} aria-labelledby={both ? undefined : 'tetro-transcript-tab'} style={{ display: both || activeTab === 'transcript' ? 'flex' : 'none', width: both ? `${ratio * 100}%` : '100%', minWidth: 0, minHeight: 0, flexDirection: 'column' }}>{transcript}</section>
      {both && <div role="separator" aria-orientation="vertical" aria-label="Resize transcript and summary" aria-valuemin={28} aria-valuemax={65} aria-valuenow={Math.round(ratio * 100)} tabIndex={0} className="tetro-pane-resizer" onPointerDown={e => { e.preventDefault(); drag.current = ratio; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (drag.current !== null && container.current) { const rect = container.current.getBoundingClientRect(); setWidth((e.clientX - rect.left) / rect.width); } }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { if (drag.current !== null) setWidth(drag.current); drag.current = null; }} onDoubleClick={() => setWidth(.36)} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(ratio + (e.key === 'ArrowLeft' ? -.02 : .02)); } if (e.key === 'Home') setWidth(.28); if (e.key === 'End') setWidth(.65); }} />}
      <section id="tetro-notes" className="tetro-sheet" role={both ? 'region' : 'tabpanel'} aria-label={both ? 'Summary' : undefined} aria-labelledby={both ? undefined : 'tetro-notes-tab'} style={{ display: both || activeTab === 'summary' ? 'flex' : 'none', flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'column' }}>{summary}</section>
    </div>
  </div>;
}

