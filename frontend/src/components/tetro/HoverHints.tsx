'use client';

import { useEffect, useRef, useState } from 'react';

const DELAY = 420; // 40% sooner than the original 700 ms

/**
 * App-wide hover hints for any element with a `title`. The native browser tooltip is slow
 * and unstyled, so the title is moved to `data-hint` while hovered and shown here instead.
 */
export function HoverHints() {
  const [hint, setHint] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const timer = useRef<number>();
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const restore = () => {
      const el = current.current;
      if (el?.dataset.hint !== undefined) { el.setAttribute('title', el.dataset.hint); delete el.dataset.hint; }
      current.current = null;
    };
    const hide = () => { window.clearTimeout(timer.current); setHint(null); restore(); };
    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[title]');
      if (!el || el === current.current) return;
      hide();
      const text = el.getAttribute('title');
      if (!text) return;
      el.dataset.hint = text; el.removeAttribute('title');
      current.current = el;
      timer.current = window.setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 48;
        setHint({ text, x: Math.min(Math.max(r.left + r.width / 2, 90), window.innerWidth - 90), y: below ? r.bottom + 8 : r.top - 8, below });
      }, DELAY);
    };
    const out = (e: PointerEvent) => {
      if (current.current && !current.current.contains(e.relatedTarget as Node | null)) hide();
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    return () => { hide(); document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out); document.removeEventListener('pointerdown', hide, true); window.removeEventListener('scroll', hide, true); };
  }, []);

  if (!hint) return null;
  return <div className={`tetro-hint ${hint.below ? 'is-below' : ''}`} role="tooltip" style={{ left: hint.x, top: hint.y }}>{hint.text}</div>;
}
