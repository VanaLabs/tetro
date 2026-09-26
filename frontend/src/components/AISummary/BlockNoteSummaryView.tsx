"use client";

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { Summary, SummaryDataResponse, BlockNoteBlock } from '@/types';
import { AISummary } from './index';
import { Block } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { blocksToMarkdownSafely } from '@/lib/blocknote-markdown';
import { useTheme } from '@/contexts/ThemeContext';
import { invoke } from '@tauri-apps/api/core';
import { SavedEdit, TEXT_UPDATED } from '@/lib/meeting-edits';
import { wholeWord } from '@/lib/transcriptEdit';
import { blockText, contentSignature } from '@/lib/summary-edit-state';
import "@blocknote/shadcn/style.css";

interface BlockNoteSummaryViewProps {
  summaryData: SummaryDataResponse | Summary | null;
  onSave?: (data: { markdown?: string; summary_json?: BlockNoteBlock[] }) => Promise<void>;
  onSummaryChange?: (summary: Summary) => void;
  status?: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  error?: string | null;
  onRegenerateSummary?: () => void;
  meeting?: {
    id: string;
    title: string;
    created_at: string;
  };
  onDirtyChange?: (isDirty: boolean) => void;
}

export interface BlockNoteSummaryViewRef {
  saveSummary: () => Promise<void>;
  getMarkdown: () => Promise<string>;
  isDirty: boolean;
}


function replaceBlocksText(blocks: Block[], from: string, to: string): Block[] {
  return JSON.parse(JSON.stringify(blocks), (key, value) => key === 'text' && typeof value === 'string' ? value.replace(wholeWord(from), to) : value);
}

export const BlockNoteSummaryView = forwardRef<BlockNoteSummaryViewRef, BlockNoteSummaryViewProps>(({
  summaryData, onSave, onSummaryChange, status = 'idle', error = null, onRegenerateSummary, meeting, onDirtyChange,
}, ref) => {
  const data = summaryData as { markdown?: string; summary_json?: Block[] } | null;
  const modern = !!(data?.markdown || data?.summary_json);
  const { theme } = useTheme();
  const editor = useCreateBlockNote({});
  const root = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const dirty = useRef(false);
  const base = useRef<Block[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [edits, setEdits] = useState<SavedEdit[]>([]);
  const [revision, setRevision] = useState(0);
  const [earlierDraft, setEarlierDraft] = useState<Block[] | null>(null);
  const draftKey = `tetro.summaryDraft.${meeting?.id ?? 'unsaved'}`;
  const setDirty = useCallback((value: boolean) => { dirty.current = value; setIsDirty(value); }, []);
  useEffect(() => { loaded.current = false; setDirty(false); setMessage(''); }, [meeting?.id, setDirty]);

  useEffect(() => {
    let cancelled = false;
    if (!modern || dirty.current) return;
    loaded.current = false;
    const load = async () => {
      try {
        const parsed = data?.summary_json?.length ? data.summary_json : await editor.tryParseMarkdownToBlocks(data?.markdown ?? '');
        if (cancelled) return;
        let restored: Block[] | undefined;
        setEarlierDraft(null);
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.sourceMarkdown === data?.markdown) restored = saved.blocks;
            else if (saved.blocks?.length) setEarlierDraft(saved.blocks);
          }
        } catch { /* The original saved notes are still available. */ }
        editor.replaceBlocks(editor.document, parsed);
        base.current = structuredClone(editor.document);
        if (restored?.length) editor.replaceBlocks(editor.document, restored);
        setBlocks([...editor.document]);
        if (restored?.length) { setDirty(true); setMessage('Your unfinished edits are here.'); }
        loaded.current = true;
      } catch { setMessage('These notes could not be opened. Your saved copy is unchanged.'); }
    };
    void load();
    return () => { cancelled = true; };
  }, [data?.markdown, data?.summary_json, draftKey, editor, modern, setDirty]);

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => {
    if (!meeting?.id) return;
    let cancelled = false;
    invoke<SavedEdit[]>('api_get_meeting_edits', { meetingId: meeting.id }).then(rows => { if (!cancelled) setEdits(rows.filter(e => e.kind === 'summary')); }).catch(() => {});
    return () => { cancelled = true; };
  }, [meeting?.id, data, revision]);

  const changed = useCallback(() => {
    if (!loaded.current) return;
    const current = [...editor.document]; setBlocks(current);
    const different = contentSignature(current) !== contentSignature(base.current);
    setDirty(different); setMessage('');
    try { if (different) localStorage.setItem(draftKey, JSON.stringify({ blocks: current, sourceMarkdown: data?.markdown })); else if (!earlierDraft) localStorage.removeItem(draftKey); }
    catch { setMessage('This draft could not be kept automatically. Save your edits before leaving.'); }
  }, [editor, draftKey, setDirty, data?.markdown, earlierDraft]);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.meetingId !== meeting?.id) return;
      setRevision(r => r + 1);
      // Keep an open, unsaved draft in step with a name corrected in the transcript.
      if (dirty.current && detail.correction) {
        editor.replaceBlocks(editor.document, replaceBlocksText(editor.document, detail.correction.from, detail.correction.to));
        changed();
      }
    };
    window.addEventListener(TEXT_UPDATED, update);
    return () => window.removeEventListener(TEXT_UPDATED, update);
  }, [meeting?.id, editor, changed]);

  useEffect(() => {
    let sectionEdited = edits.some(e => e.anchor === '__intro:1');
    for (const block of blocks) {
      const firstInline = Array.isArray(block.content) ? block.content[0] as { text?: string; styles?: { bold?: boolean } } : undefined;
      const boldLabel = block.type === 'paragraph' && firstInline?.styles?.bold ? firstInline.text?.trim() : undefined;
      if (block.type === 'heading' || boldLabel) {
        const heading = (boldLabel || blockText(block)).trim().toLowerCase();
        sectionEdited = edits.some(e => e.anchor.replace(/:\d+$/, '') === heading) || (heading === 'your edits' && edits.length > 0);
      }
      const original = base.current.find(b => b.id === block.id);
      const changedByHand = isDirty && (!original || blockText(original) !== blockText(block));
      const el = root.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(block.id)}"]`);
      if (el) { el.dataset.userEdited = sectionEdited || changedByHand ? 'true' : 'false'; }
    }
  }, [blocks, edits, isDirty]);

  const getMarkdown = useCallback(async () => {
    const result = await blocksToMarkdownSafely(editor, editor.document, { source: 'Tetro notes editor' });
    if (!result.ok || result.markdown === undefined) throw new Error('Could not prepare these notes. Your edits are still here; please try again.');
    return result.markdown;
  }, [editor]);
  const save = useCallback(async () => {
    if (!onSave || !dirty.current || saving) return;
    setSaving(true); setMessage('');
    const savedBlocks = structuredClone(editor.document);
    try {
      const markdown = await getMarkdown();
      await onSave({ markdown, summary_json: savedBlocks as unknown as BlockNoteBlock[] });
      // The editor is disabled during save. A matching-name correction may have
      // updated these blocks and the stored notes together during onSave.
      base.current = structuredClone(editor.document);
      setDirty(false); setEarlierDraft(null);
      try { localStorage.removeItem(draftKey); } catch { /* Saved in the database. */ }
      setMessage('Saved');
      setRevision(r => r + 1);
    } catch (e) { setMessage(String(e)); throw e; }
    finally { setSaving(false); }
  }, [onSave, saving, editor, getMarkdown, draftKey, setDirty]);
  const cancel = () => {
    loaded.current = false; editor.replaceBlocks(editor.document, structuredClone(base.current));
    setBlocks([...editor.document]); try { localStorage.removeItem(draftKey); } catch { /* Keep the saved notes visible. */ } setDirty(false); setMessage(''); loaded.current = true;
  };
  useImperativeHandle(ref, () => ({ saveSummary: save, getMarkdown, isDirty }), [save, getMarkdown, isDirty]);

  if (!modern) return <AISummary summary={summaryData as Summary} status={status} error={error} onSummaryChange={onSummaryChange ?? (() => {})} onRegenerateSummary={onRegenerateSummary ?? (() => {})} meeting={meeting} />;
  return <div ref={root} className="tetro-notes-editor w-full">
    {earlierDraft && <div className="tetro-edit-state" role="status"><span>Unfinished edits from an earlier version are available.</span><button className="tetro-link" onClick={() => { editor.replaceBlocks(editor.document, earlierDraft); setEarlierDraft(null); changed(); }}>Open those edits</button><button className="tetro-link" onClick={() => { try { localStorage.removeItem(draftKey); } catch {} setEarlierDraft(null); }}>Discard draft</button></div>}
    <BlockNoteView editor={editor} editable={!saving} onChange={changed} theme={theme} />
    {(isDirty || message || edits.length > 0) && <div className="tetro-edit-state" role="status">
      <span>{saving ? 'Saving…' : message || (isDirty ? 'Unsaved edits' : 'Tinted text was edited by you')}</span>
      {isDirty && <button className="tetro-link" disabled={saving} onClick={cancel}>Cancel edits</button>}
    </div>}
  </div>;
});
BlockNoteSummaryView.displayName = 'BlockNoteSummaryView';
