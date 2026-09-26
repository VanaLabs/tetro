import type { ReactNode } from 'react';

/** One compact settings line: label and optional hint on the left, the control on the right. */
export function SettingRow({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  return <div className="tetro-setting-row">
    <div className="tetro-setting-text">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="tetro-setting-label">{label}</span>}
      {hint && <p>{hint}</p>}
    </div>
    {children && <div className="tetro-setting-control">{children}</div>}
  </div>;
}

/** A titled group of setting rows. */
export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="tetro-setting-group">
    <h3>{title}</h3>
    <div className="tetro-setting-rows">{children}</div>
  </section>;
}

/** Small segmented control for 2–4 exclusive choices. */
export function Segmented<T extends string>({ value, options, onChange, label, disabled = false }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (value: T) => void; label: string; disabled?: boolean }) {
  return <div className="tetro-format" role="radiogroup" aria-label={label}>
    {options.map((o, index) => <button key={o.value} type="button" role="radio" disabled={disabled} tabIndex={value === o.value ? 0 : -1} aria-checked={value === o.value} onClick={() => onChange(o.value)} onKeyDown={event => {
      const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      if (!delta) return;
      event.preventDefault();
      const next = (index + delta + options.length) % options.length;
      (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
      onChange(options[next].value);
    }}>{o.label}</button>)}
  </div>;
}

/** "/Users/ana/Library/Application Support/x" -> "~/Library/Application Support/x" */
export function shortPath(path?: string | null) {
  return path ? path.replace(/^\/Users\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/i, '~') : '';
}
