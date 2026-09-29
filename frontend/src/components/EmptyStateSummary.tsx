'use client';

import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { openSummaryModelChoices } from '@/lib/model-settings-route';

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
  const router = useRouter();
  const chooseModel = () => openSummaryModelChoices(href => router.push(href));
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="tetro-empty-notes"
    >
      <h3>No summary yet</h3>
      <p>
        {hasTranscript ? 'Choose a template and turn this transcript into a summary that fits the recording.' : 'Transcribe the recording first. You can create a summary once there’s some text.'}
      </p>

      {suggestion && (
        <p className="tetro-suggestion">This looks like a <b>{suggestion.name}</b>. <button className="tetro-link" onClick={suggestion.onUse}>Use that template</button></p>
      )}

      {error && (
        <p role="alert" className="tetro-empty-error">
          {error}
        </p>
      )}

      {hasTranscript && <Button
        onClick={hasModel ? onGenerate : chooseModel}
        disabled={isGenerating}
        className="tetro-key tetro-key-amber"
      >
        <Sparkles className="w-4 h-4" />
        {!hasModel ? 'Choose summary model' : isGenerating ? 'Generating…' : error ? 'Try again' : 'Write summary'}
      </Button>}
    </motion.div>
  );
}
