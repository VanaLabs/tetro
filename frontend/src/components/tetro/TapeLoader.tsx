'use client';

import { useEffect, useId, useRef, useState } from 'react';

/*
 * A cassette for long waits. Tape moves at a constant linear speed, so each reel turns at
 * ω = v / r: the full reel turns slowly, the empty one fast, and they trade places as tape
 * crosses over. When a side runs out it auto-reverses, like a deck with auto-reverse.
 * Everything is driven from one requestAnimationFrame loop that writes SVG attributes
 * directly (no React re-renders per frame).
 */

const HUB = 8.5;          // hub radius (tape can't go below this)
const FULL = 25;          // pack radius when a reel holds all the tape
const AREA = FULL * FULL - HUB * HUB;
const TAPE_SPEED = 16;    // SVG units per second at the pack edge (busy, not frantic)
const PASS = 7;           // seconds for the tape to move from one reel to the other
const L = { x: 72, y: 54 }, R = { x: 148, y: 54 };
const WINDOW = { x: 44, y: 36, w: 132, h: 36 };

const packRadii = (p: number) => ({ left: Math.sqrt(FULL * FULL - p * AREA), right: Math.sqrt(HUB * HUB + p * AREA) });

function Hub({ id }: { id: string }) {
  // Six drive teeth on the inside of a white ring, like a real cassette hub.
  return <g id={id}>
    <circle r={HUB} className="tl-hub" />
    <circle r={HUB - 2.6} className="tl-hub-hole" />
    {[0, 60, 120, 180, 240, 300].map(a => <rect key={a} x={-1} y={-(HUB - 0.6)} width={2} height={3.2} rx={0.5} className="tl-hub" transform={`rotate(${a})`} />)}
  </g>;
}

export function TapeLoader({ label, detail, onCancel }: { label: string; detail?: string; onCancel?: () => void | Promise<void> }) {
  const [stopping, setStopping] = useState(false);
  const uid = useId().replace(/:/g, '');
  const refs = useRef<Record<string, SVGElement | null>>({});
  const [still, setStill] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    setStill(reduce.matches);
    if (reduce.matches) return;
    let raf = 0, last = performance.now();
    const start = last;
    let p = 0.18, dir = 1, aL = 0, aR = 0, tapeOffset = 0, pause = 0;
    const set = (key: string, attr: string, value: string | number) => refs.current[key]?.setAttribute(attr, String(value));
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (pause > 0) { pause -= dt; } else {
        const { left, right } = packRadii(p);
        // Constant tape speed moves a constant area of tape per second from one pack to the
        // other, so the transferred fraction grows linearly: one side takes PASS seconds.
        p += dir * dt / PASS;
        aL += (dir * TAPE_SPEED / left) * dt * (180 / Math.PI);
        aR += (dir * TAPE_SPEED / right) * dt * (180 / Math.PI);
        tapeOffset -= dir * TAPE_SPEED * dt * 0.9;
        if (p >= 1 || p <= 0) { p = Math.min(1, Math.max(0, p)); dir = -dir; pause = 0.35; set('lampF', 'data-on', dir > 0 ? '1' : '0'); set('lampR', 'data-on', dir < 0 ? '1' : '0'); }
      }
      const { left, right } = packRadii(p);
      set('packL', 'r', left.toFixed(2)); set('packR', 'r', right.toFixed(2));
      set('sheenL', 'r', (left - 1.2).toFixed(2)); set('sheenR', 'r', (right - 1.2).toFixed(2));
      set('hubL', 'transform', `translate(${L.x} ${L.y}) rotate(${aL.toFixed(2)})`);
      set('hubR', 'transform', `translate(${R.x} ${R.y}) rotate(${aR.toFixed(2)})`);
      set('rollL', 'transform', `translate(34 116) rotate(${(-tapeOffset * 10).toFixed(1)})`);
      set('rollR', 'transform', `translate(186 116) rotate(${(-tapeOffset * 10).toFixed(1)})`);
      set('tape', 'stroke-dashoffset', tapeOffset.toFixed(2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const clock = window.setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => { cancelAnimationFrame(raf); window.clearInterval(clock); };
  }, []);

  const r = (key: string) => (el: SVGElement | null) => { refs.current[key] = el; };
  const init = packRadii(0.18);
  const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return <div className="tetro-tape-loader" role="status" aria-live="polite">
    <svg viewBox="0 0 220 140" className="tl" aria-hidden="true">
      <defs>
        <clipPath id={`win-${uid}`}><rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} rx={WINDOW.h / 2} /></clipPath>
        <radialGradient id={`pack-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0.35" className="tl-pack-in" /><stop offset="0.92" className="tl-pack-mid" /><stop offset="1" className="tl-pack-edge" />
        </radialGradient>
        <linearGradient id={`glass-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".16" /><stop offset=".38" stopColor="#fff" stopOpacity=".03" /><stop offset=".4" stopColor="#fff" stopOpacity=".1" /><stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Shell, screws and the bottom opening */}
      <rect x="3" y="3" width="214" height="134" rx="11" className="tl-shell" />
      <rect x="3.5" y="3.5" width="213" height="133" rx="10.5" className="tl-bevel" />
      {[[13, 13], [207, 13], [13, 127], [207, 127]].map(([x, y]) => <g key={`${x}${y}`} transform={`translate(${x} ${y})`}><circle r="3.2" className="tl-screw" /><path d="M-2 -0.4h4v0.8h-4z" className="tl-screw-slot" transform={`rotate(${(x * 7 + y * 3) % 180})`} /></g>)}
      <path d="M40 137 L50 104 H170 L180 137" className="tl-opening" />

      {/* Label */}
      <rect x="20" y="12" width="180" height="84" rx="5" className="tl-label" />
      <rect x="20" y="12" width="180" height="7" rx="3" className="tl-label-stripe" />
      <text x="30" y="30" className="tl-label-brand">Tetro</text>
      <path d="M58 29 H150 M30 88 H190" className="tl-label-rule" />
      <text x="190" y="30" className="tl-label-side" textAnchor="end">A</text>

      {/* Window: tape packs cropped by the window, hubs turning */}
      <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} rx={WINDOW.h / 2} className="tl-window" />
      <g clipPath={`url(#win-${uid})`}>
        <circle ref={r('packL')} cx={L.x} cy={L.y} r={init.left} fill={`url(#pack-${uid})`} />
        <circle ref={r('packR')} cx={R.x} cy={R.y} r={init.right} fill={`url(#pack-${uid})`} />
        <circle ref={r('sheenL')} cx={L.x} cy={L.y} r={init.left - 1.2} className="tl-pack-sheen" />
        <circle ref={r('sheenR')} cx={R.x} cy={R.y} r={init.right - 1.2} className="tl-pack-sheen" />
        <g ref={r('hubL')} transform={`translate(${L.x} ${L.y})`}><Hub id={`hl-${uid}`} /></g>
        <g ref={r('hubR')} transform={`translate(${R.x} ${R.y})`}><Hub id={`hr-${uid}`} /></g>
        <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} fill={`url(#glass-${uid})`} />
      </g>
      <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} rx={WINDOW.h / 2} className="tl-window-rim" />

      {/* Tape path along the bottom: guides, head, moving tape */}
      <line x1="30" y1="121.5" x2="190" y2="121.5" className="tl-tape" />
      <line ref={r('tape')} x1="30" y1="121.5" x2="190" y2="121.5" className="tl-tape-marks" />
      <g ref={r('rollL')} transform="translate(34 116)"><circle r="5.5" className="tl-roller" /><circle r="2" className="tl-roller-hub" /><rect x="-0.6" y="-5.2" width="1.2" height="2.4" rx="0.5" className="tl-roller-notch" /></g>
      <g ref={r('rollR')} transform="translate(186 116)"><circle r="5.5" className="tl-roller" /><circle r="2" className="tl-roller-hub" /><rect x="-0.6" y="-5.2" width="1.2" height="2.4" rx="0.5" className="tl-roller-notch" /></g>
      <rect x="99" y="112" width="22" height="8" rx="1.5" className="tl-head" />
      <rect x="107.5" y="119.5" width="5" height="2.5" rx="0.6" className="tl-head-gap" />

      {/* Auto-reverse lamps */}
      <path ref={r('lampF')} data-on="1" d="M123 131 l-5 -3 v6z" className="tl-lamp" />
      <path ref={r('lampR')} data-on="0" d="M97 131 l5 -3 v6z" className="tl-lamp" />
    </svg>
    <p className="tetro-tape-label">{label}</p>
    {detail && <p className="tetro-tape-detail">{detail}</p>}
    {!still && <p className="tetro-tape-time" aria-hidden="true">{time}</p>}
    {onCancel && <button className="tetro-key" disabled={stopping} onClick={async () => { setStopping(true); try { await onCancel(); } finally { setStopping(false); } }}>{stopping ? 'Stopping…' : 'Stop summarizing'}</button>}
  </div>;
}
