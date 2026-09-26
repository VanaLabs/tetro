'use client';

import { useEffect, useId, useRef } from 'react';

/*
 * A reel-to-reel recorder for retranscription. The supply reel really empties as work
 * progresses (fed by `progress`), both reels turn at ω = v / r for a constant tape speed,
 * the tape runs over a guide, past the head and through capstan + pinch roller, and a
 * small VU needle breathes. One requestAnimationFrame loop writes SVG attributes directly.
 */

const HUB = 11, FULL = 36, AREA = FULL * FULL - HUB * HUB;
const L = { x: 66, y: 60 }, R = { x: 194, y: 60 };
const GUIDE_L = { x: 96, y: 118 }, CAPSTAN = { x: 164, y: 121 }, GUIDE_R = { x: 176, y: 114 };
const TAPE_SPEED = 26;

const radii = (p: number) => ({ left: Math.sqrt(FULL * FULL - p * AREA), right: Math.sqrt(HUB * HUB + p * AREA) });

/** Point where a tape leaving a reel of radius r (centre c) meets a straight line to point t, on the given side. */
function tangent(c: { x: number; y: number }, r: number, t: { x: number; y: number }, side: 1 | -1) {
  const dx = t.x - c.x, dy = t.y - c.y, d = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx) + side * Math.acos(Math.min(1, r / d));
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
}

function Reel({ id }: { id: string }) {
  // Metal flange with three windows (cut by a mask so the tape pack shows through), plus the hub.
  return <>
    <mask id={id}>
      <circle r="44" fill="#fff" />
      {[0, 120, 240].map(a => <path key={a} d="M -7.45 -15.28 A 17 17 0 0 1 7.45 -15.28 L 15.78 -32.36 A 36 36 0 0 0 -15.78 -32.36 Z" fill="#000" transform={`rotate(${a})`} />)}
    </mask>
    <circle r="44" className="rl-flange" mask={`url(#${id})`} />
    <circle r="44" className="rl-flange-rim" />
    <circle r="11" className="rl-hub" />
    {[0, 120, 240].map(a => <rect key={a} x="-1.4" y="-11" width="2.8" height="4.5" rx="0.8" className="rl-hub-key" transform={`rotate(${a})`} />)}
    <circle r="3.2" className="rl-spindle" />
  </>;
}

export function RecorderLoader({ progress, label, detail, stage, onCancel, stopping = false }: {
  /** 0..1, or null while it's starting. */
  progress: number | null;
  label: string;
  detail?: string;
  stage?: string;
  stopping?: boolean; onCancel?: () => void;
}) {
  const uid = useId().replace(/:/g, '');
  const refs = useRef<Record<string, SVGElement | null>>({});
  const target = useRef(0);
  target.current = progress ?? 0;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0, last = performance.now(), p = target.current, aL = 0, aR = 0, dash = 0, needle = 0, phase = 0;
    const set = (k: string, attr: string, v: string | number) => refs.current[k]?.setAttribute(attr, String(v));
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      // Ease the tape pack toward real progress; creep a little while waiting for the first report.
      p += ((Math.max(target.current, p + 0.0004) - p) * Math.min(1, dt * 1.8));
      p = Math.min(1, p);
      const { left, right } = radii(p);
      aL += (TAPE_SPEED / left) * dt * 57.3; aR += (TAPE_SPEED / right) * dt * 57.3;
      dash -= TAPE_SPEED * dt; phase += dt;
      needle += ((-18 + 26 * Math.abs(Math.sin(phase * 3.1) * Math.sin(phase * 1.7 + 1))) - needle) * Math.min(1, dt * 9);
      set('packL', 'r', left.toFixed(2)); set('packR', 'r', right.toFixed(2));
      set('reelL', 'transform', `translate(${L.x} ${L.y}) rotate(${aL.toFixed(1)})`);
      set('reelR', 'transform', `translate(${R.x} ${R.y}) rotate(${aR.toFixed(1)})`);
      const a = tangent(L, left, GUIDE_L, -1), b = tangent(R, right, GUIDE_R, 1);
      set('tape', 'd', `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${GUIDE_L.x} ${GUIDE_L.y + 4} L${CAPSTAN.x} ${CAPSTAN.y + 3} L${GUIDE_R.x} ${GUIDE_R.y + 4} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
      set('tape', 'stroke-dashoffset', dash.toFixed(1));
      set('pinch', 'transform', `translate(${CAPSTAN.x} ${CAPSTAN.y + 10}) rotate(${(-dash * 12).toFixed(0)})`);
      set('needle', 'transform', `rotate(${needle.toFixed(1)} 130 40)`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const r = (k: string) => (el: SVGElement | null) => { refs.current[k] = el; };
  const init = radii(progress ?? 0);
  const pct = progress === null ? null : Math.round(progress * 100);

  return <div className="tetro-tape-loader tetro-recorder-loader" role="status" aria-live="polite">
    <svg viewBox="0 0 260 150" className="rl" aria-hidden="true">
      <rect x="2" y="2" width="256" height="146" rx="10" className="tl-shell" />
      <rect x="2.5" y="2.5" width="255" height="145" rx="9.5" className="tl-bevel" />

      {/* Tape leaves each pack from under its flange */}
      <path ref={r('tape')} className="rl-tape" d="" />

      {/* Tape packs sit under the flanges and show through their windows */}
      <circle ref={r('packL')} cx={L.x} cy={L.y} r={init.left} className="rl-pack" />
      <circle ref={r('packR')} cx={R.x} cy={R.y} r={init.right} className="rl-pack" />
      <g ref={r('reelL')} transform={`translate(${L.x} ${L.y})`}><Reel id={`fl-${uid}`} /></g>
      <g ref={r('reelR')} transform={`translate(${R.x} ${R.y})`}><Reel id={`fr-${uid}`} /></g>

      {/* VU meter between the reels */}
      <rect x="112" y="22" width="36" height="24" rx="3" className="rl-vu" />
      <path d="M117 40 A 16 16 0 0 1 143 40" className="rl-vu-scale" />
      <path d="M137 30 A 16 16 0 0 1 143 40" className="rl-vu-red" />
      <line ref={r('needle')} x1="130" y1="40" x2="130" y2="27" className="rl-needle" />
      <circle cx="130" cy="40" r="1.6" className="rl-needle-pin" />

      {/* Tape path: guide, head, capstan with pinch roller, guide */}
      <circle cx={GUIDE_L.x} cy={GUIDE_L.y} r="4" className="tl-roller" />
      <circle cx={GUIDE_R.x} cy={GUIDE_R.y} r="4" className="tl-roller" />
      <rect x="120" y="110" width="20" height="11" rx="2" className="tl-head" />
      <rect x="128" y="119" width="4" height="3" rx="0.6" className="tl-head-gap" />
      <circle cx={CAPSTAN.x} cy={CAPSTAN.y} r="2.4" className="rl-capstan" />
      <g ref={r('pinch')} transform={`translate(${CAPSTAN.x} ${CAPSTAN.y + 10})`}><circle r="6" className="rl-pinch" /><rect x="-0.7" y="-5.6" width="1.4" height="2.6" rx="0.5" className="tl-roller-notch" /></g>

      {/* Transport lamp */}
      <circle cx="226" cy="132" r="2.6" className="rl-lamp" />
      <text x="220" y="134.6" textAnchor="end" className="rl-lamp-label">PLAY</text>
    </svg>
    <p className="tetro-tape-label">{label}</p>
    {detail && <p className="tetro-tape-detail">{detail}</p>}
    <div className="tetro-recorder-progress">
      <div className="tetro-progress"><i style={{ width: `${pct ?? 2}%` }} /></div>
      <span>{pct === null ? 'Starting…' : `${pct}%`}</span>
    </div>
    {onCancel && <button className="tetro-key" disabled={stopping} onClick={onCancel}>{stopping ? 'Stopping…' : 'Stop transcribing'}</button>}
  </div>;
}
