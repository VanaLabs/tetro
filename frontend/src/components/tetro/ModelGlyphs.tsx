'use client';

export { TetroMark } from './TetroBrand';

// Tetro model glyphs: each model is drawn as a tape reel whose wound tape grows with its
// download size, and its speed/accuracy are shown as small LED segment meters.

// Native speed labels look like "Very Fast" or "Ultra Fast (v3)"; the version suffix is dropped.
const SPEED_LEVEL: Record<string, number> = { Slow: 1, Medium: 2, Fast: 3, 'Very Fast': 4, 'Ultra Fast': 4 };
const ACCURACY_LEVEL: Record<string, number> = { Basic: 1, Decent: 2, Good: 3, High: 4 };
const level = (table: Record<string, number>, label?: string) => label ? table[label.replace(/\s*\(.*\)\s*$/, '').trim()] : undefined;

/** 0..1 share of the largest model (~2.6 GB), square-rooted so small models stay visible. */
function sizeRatio(sizeMb: number) {
  return Math.min(1, Math.sqrt(Math.max(sizeMb, 0) / 2600));
}

export function ReelGlyph({ sizeMb, active = false, className = '' }: { sizeMb: number; active?: boolean; className?: string }) {
  const pack = 5 + sizeRatio(sizeMb) * 9.5; // wound tape radius, from hub to rim
  return <svg viewBox="0 0 32 32" width="32" height="32" className={`tetro-reel-glyph ${active ? 'is-active' : ''} ${className}`} aria-hidden="true">
    <circle cx="16" cy="16" r="15" className="tetro-reel-glyph-rim" />
    <circle cx="16" cy="16" r={pack} className="tetro-reel-glyph-tape" />
    <circle cx="16" cy="16" r="4.2" className="tetro-reel-glyph-hub" />
    {[0, 120, 240].map(a => <rect key={a} x="15.3" y="12" width="1.4" height="3" rx=".6" className="tetro-reel-glyph-tooth" transform={`rotate(${a} 16 16)`} />)}
  </svg>;
}

export function SegmentMeter({ label, level, max = 4 }: { label: string; level: number; max?: number }) {
  return <span className="tetro-meter" role="img" aria-label={`${label}: ${level} of ${max}`}>
    <span className="tetro-meter-label">{label}</span>
    <span className="tetro-meter-bar">{Array.from({ length: max }, (_, i) => <i key={i} data-on={i < level || undefined} />)}</span>
  </span>;
}

export function ModelSpecs({ sizeLabel, speed, accuracy, languages }: { sizeLabel: string; speed?: string; accuracy?: string; languages?: string }) {
  const speedLevel = level(SPEED_LEVEL, speed);
  const accuracyLevel = level(ACCURACY_LEVEL, accuracy);
  return <div className="tetro-model-specs">
    <span className="tetro-model-size">{sizeLabel}</span>
    {languages && <span className="tetro-model-size">{languages}</span>}
    {speedLevel !== undefined && <SegmentMeter label="Speed" level={speedLevel} />}
    {accuracyLevel !== undefined && <SegmentMeter label="Accuracy" level={accuracyLevel} />}
  </div>;
}

/** Engine marks for the transcription provider picker. */
export function ProviderGlyph({ kind }: { kind: 'parakeet' | 'localWhisper' | string }) {
  if (kind === 'parakeet') {
    // Streaming waveform: transcribes in real time
    return <svg viewBox="0 0 16 16" width="16" height="16" className="tetro-provider-glyph" aria-hidden="true">
      {[2, 5, 8, 11, 14].map((x, i) => <rect key={x} x={x - 0.75} y={8 - [2, 5, 6.5, 4, 2.5][i]} width="1.5" height={[2, 5, 6.5, 4, 2.5][i] * 2} rx=".75" fill="currentColor" />)}
    </svg>;
  }
  // Local reel: runs fully on the device, favours accuracy
  return <svg viewBox="0 0 16 16" width="16" height="16" className="tetro-provider-glyph" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="8" cy="8" r="2" fill="currentColor" />
    <path d="M8 1.5v3M13.6 11.2l-2.6-1.5M2.4 11.2 5 9.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}
