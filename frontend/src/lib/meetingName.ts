import { invoke } from '@tauri-apps/api/core';

export type DateOrder = 'dmy' | 'mdy' | 'ymd';
export type NameFormat = { order: DateOrder; timeFirst: boolean };

let current: NameFormat = { order: 'ymd', timeFirst: false };

/** Default meeting name, e.g. "Meeting 23-09-2026 14:05" or "Meeting 14:05 2026-09-23". */
export function formatMeetingName(at: Date, format: NameFormat = current): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = pad(at.getDate()), m = pad(at.getMonth() + 1), y = String(at.getFullYear());
  const date = format.order === 'dmy' ? `${d}-${m}-${y}` : format.order === 'mdy' ? `${m}-${d}-${y}` : `${y}-${m}-${d}`;
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return `Meeting ${format.timeFirst ? `${time} ${date}` : `${date} ${time}`}`;
}

/** The recording folder name the native side will create for a default-named meeting. */
export function formatFolderName(at: Date, format: NameFormat = current): string {
  return formatMeetingName(at, format).replace(/:/g, '_');
}

export function setNameFormat(format: NameFormat) { current = format; }

export async function loadNameFormat() {
  try {
    const prefs = await invoke<{ name_date_order?: DateOrder | null; name_time_first?: boolean | null }>('get_recording_preferences');
    current = { order: prefs.name_date_order ?? 'ymd', timeFirst: prefs.name_time_first ?? false };
  } catch { /* keep the default */ }
  return current;
}

/** True for names Tetro generated (safe to replace with the notes title); mirrors the native check. */
export function isDefaultMeetingName(title: string) {
  const t = title.trim();
  if (!t || ['New recording', 'Untitled recording', '+ New Call'].includes(t)) return true;
  return /^Meeting[\d\s_\-:./]+$/.test(t) && /\d/.test(t);
}
