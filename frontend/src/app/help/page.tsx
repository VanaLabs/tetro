'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GUIDE_TOPICS as TOPICS } from './topics';

const TAB_LABELS = ['Record', 'Import', 'Transcript', 'Summaries', 'Templates', 'Models', 'Tasks', 'Files'] as const;

export default function HelpPage() {
  const router = useRouter();
  const [topic, setTopic] = useState(0);
  const [step, setStep] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);
  const current = TOPICS[topic].steps[step];
  const last = step === TOPICS[topic].steps.length - 1;
  const openTopic = (index: number) => { setTopic(index); setStep(0); };
  return <div className="tetro-help">
    <p className="tetro-help-intro">Choose a topic, then use Back and Next. Open Read all steps to scan the full guide.</p>
    <div ref={tabs} className="tetro-help-tabs" role="tablist" aria-label="Walkthroughs">{TOPICS.map((t, i) => <button key={t.title} id={`guide-tab-${i}`} role="tab" aria-label={t.title} title={t.title} aria-controls="guide-panel" aria-selected={topic === i} tabIndex={topic === i ? 0 : -1} onClick={() => openTopic(i)} onKeyDown={event => {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? TOPICS.length - 1 : event.key === 'ArrowRight' ? (i + 1) % TOPICS.length : event.key === 'ArrowLeft' ? (i + TOPICS.length - 1) % TOPICS.length : null;
      if (next === null) return;
      event.preventDefault(); openTopic(next); (tabs.current?.children[next] as HTMLButtonElement)?.focus();
    }}>{TAB_LABELS[i]}</button>)}</div>
    <section id="guide-panel" className="tetro-guide" role="tabpanel" aria-labelledby={`guide-tab-${topic}`}>
      <header className="tetro-guide-heading"><h2>{TOPICS[topic].title}</h2><p>{TOPICS[topic].intro}</p></header>
      <div className="tetro-guide-caption"><span className="tetro-guide-step">{step + 1} / {TOPICS[topic].steps.length}</span><div aria-live="polite"><h3>{current.title}</h3><p>{current.text}</p></div></div>
      <div className="tetro-guide-controls"><button className="tetro-key" disabled={!step} onClick={() => setStep(s => s - 1)}>Back</button><button className="tetro-key" disabled={last} onClick={() => setStep(s => s + 1)}>Next</button></div>
      <details className="tetro-guide-outline"><summary>Read all steps</summary><ol>{TOPICS[topic].steps.map((s, i) => <li key={s.title}><button className="tetro-link" onClick={() => setStep(i)}>{i + 1}. {s.title}</button><p>{s.text}</p></li>)}</ol></details>
    </section>
    <div className="tetro-help-more">
      <details><summary>No sound or an empty transcript?</summary><p>Open Audio on New recording and check the selected microphone and computer-sound device. Watch the meters after recording starts. On macOS, microphone and screen/system-audio permissions must allow Tetro. If you changed permission, reopen Tetro. A language-specific model may not recognize other languages.</p><button className="tetro-key" onClick={() => router.push('/')}>New recording</button></details>
      <details><summary>Recording missing or playback unavailable?</summary><p>Check the meeting’s recording folder. A moved or deleted audio file cannot play; a meeting recorded with Save audio off may only have its transcript. Trash can restore items removed through Tetro. It cannot recover files deleted outside the app.</p><button className="tetro-key" onClick={() => router.push('/trash')}>Open Trash</button></details>
      <details><summary>A model is slow or won’t download?</summary><p>Keep Tetro open while a download runs, and check your internet connection and free space. Retry a failed download from Models. For slow transcription or summaries, stop the job and try a smaller installed model. Running a model needs more memory than its download size.</p></details>
      <details><summary>A connected provider isn’t working?</summary><p>Check its API key, account balance and model availability in Settings → Models. A custom server also needs the correct address and model name. Built-in models can be used without a provider account after downloading them.</p></details>
      <details><summary>What is sent off my device?</summary><p>Built-in speech and summary models process your meeting here. Connected providers receive the text needed for summaries, automatic names, template drafting and speaker labels when those features use that provider. See About → Privacy for details.</p></details>
      <details><summary>Keyboard shortcuts</summary><p>New recording: Command/Ctrl + N. Import: Command/Ctrl + O. Settings: Command/Ctrl + comma. Show or hide the meeting list: Command/Ctrl + backslash. Change background recording shortcuts in Settings → Recordings. The Help menu also lists shortcuts.</p></details>
    </div>
  </div>;
}
