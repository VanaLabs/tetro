import React from 'react';
import { Check, Cpu, House, Mic } from 'lucide-react';
import styles from './ProgressIndicator.module.css';

interface ProgressIndicatorProps {
  current: number;
  total: number;
  onStepClick?: (step: number) => void;
}

// Each step is a small hardware key, like the recorder keys: the current step is
// latched down with its LED lit, finished steps show a check, later steps sit idle.
const steps = [
  { label: 'Welcome', icon: House },
  { label: 'Choose models', icon: Cpu },
  { label: 'Permissions', icon: Mic },
];

export function ProgressIndicator({ current, total, onStepClick }: ProgressIndicatorProps) {
  return <nav className={styles.track} aria-label="Setup progress">
    {steps.slice(0, total).map(({ label, icon: Icon }, index) => {
      const step = index + 1;
      const completed = step < current;
      const active = step === current;
      const clickable = completed && Boolean(onStepClick);
      return <React.Fragment key={label}>
        {index > 0 && <span aria-hidden="true" className={styles.connector} data-complete={completed || active || undefined} />}
        <button type="button" className={styles.step} data-active={active || undefined} data-complete={completed || undefined}
          aria-current={active ? 'step' : undefined} aria-label={clickable ? `Back to ${label}, completed` : completed ? `${label}, completed` : label}
          disabled={!clickable} onClick={() => onStepClick?.(step)}>
          <span className={styles.key} aria-hidden="true">
            {completed ? <Check strokeWidth={2.25} /> : <Icon strokeWidth={1.75} />}
            <i className={styles.led} />
          </span>
          <span className={styles.label}>{label}</span>
        </button>
      </React.Fragment>;
    })}
  </nav>;
}
