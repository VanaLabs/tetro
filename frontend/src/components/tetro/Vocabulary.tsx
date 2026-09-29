'use client';

import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { BookA, X } from 'lucide-react';

export async function addVocabularyTerm(term: string) {
  const current = await invoke<string[]>('api_get_vocabulary');
  return invoke<string[]>('api_set_vocabulary', { terms: [...current, term] });
}

/** Settings → Transcription → Names & terms. */
export function VocabularyEditor() {
  const [terms, setTerms] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const load = async () => {
    setError('');
    try { setTerms(await invoke<string[]>('api_get_vocabulary')); }
    catch { setError('Couldn’t load your names and terms. Try again before making changes.'); }
  };
  useEffect(() => { void load(); }, []);

  const save = async (next: string[]) => {
    if (pending.current || terms === null) return false;
    pending.current = true; setBusy(true);
    try { setTerms(await invoke<string[]>('api_set_vocabulary', { terms: next })); return true; }
    catch (e) { toast.error('Couldn’t save names & terms', { description: String(e) }); return false; }
    finally { pending.current = false; setBusy(false); }
  };
  // Paste or type several at once, separated by commas or new lines.
  const add = async () => {
    const added = draft.split(/[,\n]/).map(t => t.trim()).filter(Boolean);
    if (!added.length) return;
    if (added.some(term => Array.from(term).length > 60)) { toast.error('Keep each name or term to 60 characters or fewer.'); return; }
    const next = [...new Map([...(terms ?? []), ...added].map(term => [term.toLocaleLowerCase(), term])).values()];
    if (next.length > 200) { toast.error('You can save up to 200 names and terms.'); return; }
    if (await save(next)) setDraft('');
  };

  return <section className="tetro-vocab-card" aria-labelledby="tetro-vocab-title">
    <div className="tetro-vocab-head">
      <BookA aria-hidden="true" />
      <div>
        <h3 id="tetro-vocab-title">Names &amp; terms</h3>
        <p>Add names, companies and specialist words to help Tetro spell them correctly. These hints are used by Whisper transcription and when writing summaries. Other speech models do not use them yet; always check the result.</p>
      </div>
      {terms && terms.length > 0 && <span className="tetro-tag">{terms.length}</span>}
    </div>
    <div className="tetro-vocab">
      {terms?.map(term => <span key={term} className="tetro-vocab-chip">{term}<button disabled={busy} onClick={() => void save(terms.filter(t => t !== term))} aria-label={`Remove ${term}`} title="Remove"><X /></button></span>)}
      <input disabled={terms === null || busy} value={draft} onChange={e => setDraft(e.target.value)} placeholder={terms?.length ? 'Add another…' : 'e.g. Aram Petrosyan, Vana Labs, OKR'} aria-label="Add a name or term"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); void add(); } }} />
      <button className="tetro-key" disabled={terms === null || busy || !draft.trim()} onClick={() => void add()}>{busy ? 'Saving…' : 'Add'}</button>
    </div>
    {error && <p role="alert">{error} <button className="tetro-link" onClick={() => void load()}>Try again</button></p>}
    <p className="tetro-vocab-tip">Press Enter or Add to save. Separate several terms with commas. Up to 200 terms, 60 characters each. Correcting a transcript also lets you add a term here.</p>
  </section>;
}
