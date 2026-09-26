import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

export type AudioLevels = { mic: number; system: number };
const EMPTY = { mic: 0, system: 0, history: Array<number>(24).fill(0) };
/** Peak to a -54 dB…0 dB meter, shared by the wordmark and both sound meters. */
export const meterLevel = (peak: number) => !Number.isFinite(peak) || peak <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(peak) + 54) / 54));

export function useRecordingLevels(active: boolean) {
  const [levels, setLevels] = useState(EMPTY);
  useEffect(() => {
    setLevels(EMPTY);
    if (!active) return;
    let disposed = false;
    const off = listen<AudioLevels>('recording-levels', ({ payload }) => {
      if (disposed) return;
      setLevels(previous => {
        const mic = Math.max(meterLevel(payload.mic), previous.mic * .8);
        const system = Math.max(meterLevel(payload.system), previous.system * .8);
        return { mic, system, history: [...previous.history.slice(1), Math.max(mic, system)] };
      });
    });
    return () => { disposed = true; void off.then(unlisten => unlisten()).catch(() => {}); };
  }, [active]);
  return active ? levels : EMPTY;
}
