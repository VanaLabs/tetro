import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke } from '@tauri-apps/api/core';

let closePrevious: (() => void) | undefined;

/** Native print-to-PDF keeps every script readable using the device's fonts. */
export async function printMeeting(markdown: string, title: string) {
  closePrevious?.();
  const host = document.createElement('div'); host.className = 'tetro-print-sheet';
  document.body.appendChild(host);
  const root = createRoot(host);
  const originalTitle = document.title;
  let closed = false;
  const cleanup = () => {
    if (closed) return; closed = true;
    window.removeEventListener('afterprint', cleanup);
    root.unmount(); host.remove(); document.title = originalTitle;
    document.body.classList.remove('tetro-printing');
    if (closePrevious === cleanup) closePrevious = undefined;
  };
  closePrevious = cleanup;
  flushSync(() => root.render(<><nav className="tetro-print-controls" aria-label="PDF preview"><button onClick={cleanup}>Back to meeting</button><button onClick={() => void invoke('print_meeting_pdf')}>Print or save PDF</button></nav><article><header className="tetro-print-brand">Tetro</header><Markdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>{alt}</span>, h2: ({ children }) => <h2 className={String(children).trim() === 'Transcript' ? 'tetro-print-transcript-title' : undefined}>{children}</h2> }}>{markdown}</Markdown></article></>));
  document.title = title; document.body.classList.add('tetro-printing');
  window.addEventListener('afterprint', cleanup, { once: true });
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  try { await invoke('print_meeting_pdf'); }
  catch (error) { cleanup(); throw error; }
}
