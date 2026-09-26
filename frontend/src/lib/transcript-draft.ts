// Keep unfinished text through navigation and virtualized rows leaving the screen.
const memory = new Map<string, string>();
const key = (id: string) => `tetro.transcriptDraft.${id}`;
export function readTranscriptDraft(id: string): string | undefined {
  try { return localStorage.getItem(key(id)) ?? memory.get(id); } catch { return memory.get(id); }
}
export function keepTranscriptDraft(id: string, text: string) {
  memory.set(id, text);
  try { localStorage.setItem(key(id), text); } catch { /* The session copy survives navigation. */ }
}
export function discardTranscriptDraft(id: string) {
  memory.delete(id);
  try { localStorage.removeItem(key(id)); } catch { /* Storage unavailable. */ }
}
