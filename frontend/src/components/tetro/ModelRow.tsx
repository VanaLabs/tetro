'use client';

import type { ReactNode } from 'react';
import { Trash2, X } from 'lucide-react';
import { ModelSpecs, ReelGlyph } from '@/components/tetro/ModelGlyphs';

export type ModelRowState =
  | { kind: 'ready' }
  | { kind: 'missing' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'cancelling' }
  | { kind: 'error'; message?: string }
  | { kind: 'corrupted' };

/**
 * One model on one line: name and what it's good for, size and meters, then the single action
 * that makes sense right now. Used on Settings → Models, where models are managed, not chosen.
 */
export function ModelRow({ name, note, sizeMb, sizeLabel, speed, accuracy, extra, badge, inUse, state, onDownload, onCancel, onDelete, onUse }: {
  name: string;
  note?: string;
  sizeMb: number;
  sizeLabel: string;
  speed?: string;
  accuracy?: string;
  /** Short spec shown next to the size, e.g. "Armenian" or "32k context". */
  extra?: string;
  badge?: ReactNode;
  inUse?: boolean;
  state: ModelRowState;
  onDownload: () => void;
  onCancel?: () => void;
  onDelete: () => void;
  onUse: () => void;
}) {
  const ready = state.kind === 'ready';
  return (
    <div className="tetro-model-row" data-ready={ready || undefined}>
      <ReelGlyph sizeMb={sizeMb} active={inUse && ready} className="tetro-model-row-reel" />
      <div className="tetro-model-row-text">
        <span className="tetro-model-row-name">{name}{badge}{inUse && ready && <em className="tetro-tag">In use</em>}</span>
        {note && <span className="tetro-model-row-note" title={note}>{note}</span>}
      </div>
      <ModelSpecs sizeLabel={sizeLabel} speed={speed} accuracy={accuracy} languages={extra} />
      <div className="tetro-model-row-action">
        {ready && !inUse && <button type="button" className="tetro-key" onClick={onUse}>Use</button>}
        {ready && <button type="button" className="tetro-model-remove" onClick={onDelete} title={`Remove ${name} from this device`} aria-label={`Remove ${name}`}><Trash2 className="h-4 w-4" /></button>}
        {state.kind === 'missing' && <button type="button" className="tetro-key" onClick={onDownload}>Download and use</button>}
        {state.kind === 'downloading' && <>
          <span className="tetro-model-progress" role="progressbar" aria-valuenow={Math.round(state.progress)} aria-valuemin={0} aria-valuemax={100} aria-label={`Downloading ${name}`}>
            <i style={{ width: `${Math.max(2, state.progress)}%` }} />
          </span>
          <span className="tetro-model-pct">{Math.round(state.progress)}%</span>
          {onCancel && <button type="button" className="tetro-model-remove" onClick={onCancel} title="Cancel download" aria-label={`Cancel downloading ${name}`}><X className="h-4 w-4" /></button>}
        </>}
        {state.kind === 'cancelling' && <span className="tetro-model-pct">Cancelling…</span>}
        {state.kind === 'error' && <button type="button" className="tetro-key" onClick={onDownload} title={state.message}>Retry</button>}
        {state.kind === 'corrupted' && <>
          <button type="button" className="tetro-key" onClick={onDownload}>Download again</button>
          <button type="button" className="tetro-model-remove" onClick={onDelete} title="Remove the damaged files" aria-label={`Remove ${name}`}><Trash2 className="h-4 w-4" /></button>
        </>}
      </div>
    </div>
  );
}

/** Maps the Whisper/Parakeet status shape to a row state. */
export function rowStateFromStatus(status: unknown, cancelling: boolean): ModelRowState {
  if (cancelling) return { kind: 'cancelling' };
  if (status === 'Available') return { kind: 'ready' };
  if (status && typeof status === 'object') {
    if ('Downloading' in status) return { kind: 'downloading', progress: (status as { Downloading: { progress: number } }).Downloading.progress };
    if ('Error' in status) return { kind: 'error', message: String((status as { Error: string }).Error) };
    if ('Corrupted' in status) return { kind: 'corrupted' };
  }
  return { kind: 'missing' };
}
