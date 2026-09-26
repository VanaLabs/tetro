"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, FileDown, Save, Share, Loader2 } from 'lucide-react';

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onExport: (includeTranscript?: boolean, format?: 'md' | 'pdf') => Promise<void>;
  isExporting: boolean;
}

/** Save (only when there are unsaved edits) and one Share menu for copy/export. */
export function SummaryUpdaterButtonGroup({ isSaving, isDirty, onSave, onCopy, onExport, isExporting }: SummaryUpdaterButtonGroupProps) {
  return (
    <ButtonGroup>
      {(isDirty || isSaving) && (
        <Button variant="outline" size="sm" className="tetro-key-amber" title={isSaving ? 'Saving…' : 'Save your edits'} aria-label="Save summary" onClick={() => { void onSave(); }} disabled={isSaving}>
          {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
          <span className="hidden @[40rem]:inline">{isSaving ? 'Saving…' : 'Save'}</span>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" title="Copy or export the summary" aria-label="Share summary" disabled={isExporting}>
            <Share />
            <span className="hidden @[40rem]:inline">Share</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void onCopy()}><Copy className="mr-2 h-4 w-4" />Copy summary</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void onExport(false, 'pdf')}><FileDown className="mr-2 h-4 w-4" />Save as PDF</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onExport(true, 'pdf')}><FileDown className="mr-2 h-4 w-4" />PDF with transcript</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void onExport(false)}><FileDown className="mr-2 h-4 w-4" />Export as Markdown</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onExport(true)}><FileDown className="mr-2 h-4 w-4" />Export with transcript</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
