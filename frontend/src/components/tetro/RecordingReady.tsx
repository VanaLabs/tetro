import { ChevronDown, Globe, SlidersHorizontal } from 'lucide-react';
/** Only supplied by New recording; saved empty recordings keep their own actions. */
export function RecordingReady({ onStart, disabled, starting, finishing, language, model, onChooseLanguage, onChooseModel }: {
  onStart: () => Promise<void>; disabled: boolean; starting: boolean; finishing: boolean;
  language: string; model: string; onChooseLanguage: () => void; onChooseModel: () => void;
}) {
  return <div className="tetro-ready tetro-ready-action">
    <p className="tetro-ready-title">{finishing ? 'Saving your recording' : starting ? 'Getting ready…' : 'Ready to record'}</p>
    <p className="tetro-ready-sub">{finishing ? 'Your recording will open when it’s ready.' : 'Your transcript appears here as people talk.'}</p>
    {!finishing && <div className="tetro-ready-settings" aria-label="Recording setup">
      <button type="button" className="tetro-ready-setting" disabled={starting} onClick={onChooseLanguage} aria-label={`Spoken language: ${language}. Change language`}>
        <Globe size={16} aria-hidden="true" /><span><small>Spoken language</small><strong>{language}</strong></span><ChevronDown size={14} aria-hidden="true" />
      </button>
      <button type="button" className="tetro-ready-setting" disabled={starting} onClick={onChooseModel} aria-label={`Transcription model: ${model}. Change model`}>
        <SlidersHorizontal size={16} aria-hidden="true" /><span><small>Transcription model</small><strong>{model}</strong></span><ChevronDown size={14} aria-hidden="true" />
      </button>
    </div>}
    {!finishing && <button type="button" className="tetro-key tetro-key-amber tetro-start-recording" disabled={disabled} aria-busy={starting} onClick={() => { void onStart(); }}>
      <span className="tetro-glyph-rec" aria-hidden="true" />{starting ? 'Starting…' : 'Start recording'}
    </button>}
  </div>;
}
