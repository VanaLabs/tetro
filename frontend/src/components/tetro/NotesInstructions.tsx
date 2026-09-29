'use client';

import { useEffect, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** Tell the notes model what to include or fix, then (re)write the notes with it. */
export function NotesInstructions({ value, onChange, onApply, hasNotes, disabled, open: controlledOpen, onOpenChange, hideTrigger = false, returnFocus }: {
  value: string; onChange: (v: string) => void; onApply: (v: string) => void; hasNotes: boolean; disabled?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean; returnFocus?: () => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);
  const set = value.trim().length > 0;
  const content = <>
      <label htmlFor="tetro-instructions">What should the summary include or fix?</label>
      <textarea id="tetro-instructions" rows={4} value={draft} onChange={e => setDraft(e.target.value)} autoFocus
        placeholder="e.g. Include the budget numbers. Name who owns each action item. The client is Acme, not Akmi." />
      <p>Used every time this meeting is summarized. Marked moments and names &amp; terms are added automatically.</p>
      <div className="tetro-dialog-actions">
        <button onClick={() => { onChange(draft); setOpen(false); }}>Save</button>
        <button className="tetro-primary" disabled={disabled || !draft.trim()} onClick={() => { onChange(draft); setOpen(false); onApply(draft); }}>{hasNotes ? 'Summarize again' : 'Summarize'}</button>
      </div>
  </>;
  if (hideTrigger) return <Dialog open={open} onOpenChange={o => { setOpen(o); if (o) setDraft(value); }}><DialogContent className="tetro-instructions tetro-instructions-dialog" onCloseAutoFocus={event => { if (returnFocus) { event.preventDefault(); returnFocus(); } }}><DialogTitle>Summary instructions</DialogTitle><DialogDescription>Tell Tetro what to include or fix.</DialogDescription>{content}</DialogContent></Dialog>;
  return <Popover open={open} onOpenChange={o => { setOpen(o); if (o) setDraft(value); }}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" aria-label="Instructions for the summary" title={set ? 'Instructions are set for this summary' : 'Tell Tetro what the summary should include'} className={set ? 'tetro-has-dot' : ''}>
        <MessageSquarePlus /><span className="hidden @[40rem]:inline">Instructions</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="tetro-instructions">
      {content}
    </PopoverContent>
  </Popover>;
}
