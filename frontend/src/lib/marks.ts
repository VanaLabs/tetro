// Moments marked during the current recording, waiting to be saved with the meeting.
import { invoke } from '@tauri-apps/api/core';

let pending: number[] = [];
const listeners = new Set<(marks: number[]) => void>();
const notify = () => listeners.forEach(l => l([...pending]));

export function addPendingMark(atSeconds: number) {
  // Two presses within 5 s are one moment.
  if (pending.some(m => Math.abs(m - atSeconds) < 5)) return false;
  pending = [...pending, Math.max(0, atSeconds)].sort((a, b) => a - b);
  notify();
  return true;
}
export function clearPendingMarks() { pending = []; notify(); }
export function subscribePendingMarks(fn: (marks: number[]) => void) { listeners.add(fn); fn([...pending]); return () => { listeners.delete(fn); }; }

/** Saves pending marks onto a just-saved meeting, then clears them. */
export async function savePendingMarks(meetingId: string) {
  if (!pending.length) return;
  const marks = pending.map(at_seconds => ({ at_seconds }));
  pending = []; notify();
  try { await invoke('api_add_meeting_marks', { meetingId, marks }); } catch (e) { console.error('Failed to save marked moments', e); }
}
