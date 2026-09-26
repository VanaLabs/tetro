'use client';

import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface EmptyStateSummaryProps {
  onGenerate: () => void;
  hasModel: boolean;
  hasTranscript?: boolean;
  isGenerating?: boolean;
  error?: string | null;
  /** A template that fits this meeting better than the selected one. */
  suggestion?: { name: string; onUse: () => void } | null;
}

export function EmptyStateSummary({
  onGenerate,
  hasModel,
  hasTranscript = true,
  isGenerating = false,
  error = null,
  suggestion = null,
}: EmptyStateSummaryProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="tetro-empty-notes"
    >
      <h3>No summary yet</h3>
      <p>
        {hasTranscript ? 'Tetro can turn this transcript into key points, decisions and action items.' : 'Transcribe the recording first. You can create a summary once there’s some text.'}
      </p>

      {suggestion && (
        <p className="tetro-suggestion">This looks like a <b>{suggestion.name}</b>. <button className="tetro-link" onClick={suggestion.onUse}>Use that template</button></p>
      )}

      {error && (
        <p role="alert" className="tetro-empty-error">
          {error}
        </p>
      )}

      {hasTranscript && <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Button
                onClick={onGenerate}
                disabled={!hasModel || !hasTranscript || isGenerating}
                className="tetro-key tetro-key-amber"
              >
                <Sparkles className="w-4 h-4" />
                {isGenerating ? 'Generating…' : error ? 'Try again' : 'Summarize'}
              </Button>
            </div>
          </TooltipTrigger>
          {hasTranscript && !hasModel && (
            <TooltipContent>
              <p>Please select a model in Settings first</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>}

      {hasTranscript && !hasModel && (
        <p className="tetro-empty-hint">
          Choose a summary model in Settings first
        </p>
      )}
    </motion.div>
  );
}
