'use client';

import { TetroBrand } from './TetroBrand';
import styles from './TetroStartupScreen.module.css';

export function TetroStartupScreen() {
  return <main className={`${styles.screen} tetro-loading`} role="status">
    <TetroBrand variant="startup" />
    <span className="sr-only">Opening Tetro…</span>
  </main>;
}
