'use client';

import { usePlayback } from '@/components/tetro/MeetingPlayer';

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** "Marked" moments above the transcript: click to jump there (and play, when audio exists). */
export function MarksStrip({ marks, segments }: { marks: number[]; segments: { id: string; timestamp: number }[] }) {
  const playback = usePlayback();
  const jump = (at: number) => {
    const line = [...segments].reverse().find(s => s.timestamp <= at) ?? segments[0];
    if (line) document.getElementById(`segment-${line.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (playback.available) playback.seek(Math.max(0, at - 5));
  };
  return <div className="tetro-marks" aria-label="Marked moments">
    <span>Marked</span>
    {marks.map(at => <button key={at} onClick={() => jump(at)} title={playback.available ? 'Play from just before this moment' : 'Show this moment'}><i aria-hidden="true" />{clock(at)}</button>)}
  </div>;
}
