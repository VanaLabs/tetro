import { invoke } from '@tauri-apps/api/core';
import { singleWordChange } from './transcriptEdit';
import { toast } from 'sonner';

export const TEXT_UPDATED = 'tetro:text-updated';
export const TRASH_UPDATED = 'tetro:trash-updated';
export type SavedEdit = { kind: 'transcript' | 'summary'; anchor: string; original_text: string; replacement_text: string; needs_review: boolean };
export type Correction = { from: string; to: string; count: number; version_id: string | null };
export function textUpdated(meetingId: string, correction?: Correction, mediaChanged = false) {
  window.dispatchEvent(new CustomEvent(TEXT_UPDATED, { detail: { meetingId, correction, mediaChanged } }));
}

// Auto-apply a short name correction; free rewrites and common sentence words
// stay local to the edited line. Matching is literal, scoped to this meeting.
export function nameCorrection(before: string, after: string) {
  const change = singleWordChange(before, after);
  if (!change || !/\p{Lu}/u.test(change.to)) return null;
  if (/^(I|We|He|She|They|It|The|A|An|Yes|No|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(change.to)) return null;
  return change;
}
export async function correctName(meetingId: string, from: string, to: string): Promise<Correction | null> {
  const result = await invoke<{ count: number; version_id: string | null }>('api_correct_meeting_term', { meetingId, from, to });
  const correction = { ...result, from, to };
  textUpdated(meetingId, correction);
  if (result.count) toast(`Updated ${result.count} matching ${result.count === 1 ? 'name' : 'names'} in this meeting`, {
    description: `“${from}” → “${to}”`,
    action: { label: 'Undo', onClick: () => { void undoCorrection(meetingId, correction).catch(e => toast.error('Could not undo the correction', { description: String(e) })); } },
    duration: 10000,
  });
  return result.count ? correction : null;
}
export async function undoCorrection(meetingId: string, correction: Correction) {
  if (!correction.version_id) return;
  await invoke('api_restore_meeting_version', { meetingId, versionId: correction.version_id });
  textUpdated(meetingId);
}
