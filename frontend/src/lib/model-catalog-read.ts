import { invoke } from '@tauri-apps/api/core';

// Share simultaneous reads only. No keys in persistent caches and no stale installed-model lists.
const inflight = new Map<string, Promise<unknown>>();
export function readModelCatalog<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const key = JSON.stringify([command, args]);
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const work = invoke<T>(command, args);
  inflight.set(key, work);
  const clear = () => { if (inflight.get(key) === work) inflight.delete(key); };
  work.then(clear, clear);
  // A timed-out native call must not hold future retries hostage.
  const timeout = setTimeout(clear, 8000);
  work.then(() => clearTimeout(timeout), () => clearTimeout(timeout));
  return work;
}

// Recommended and Installed show the same files. A removal must update both immediately.
const subscribers = new Map<string, Set<(value: unknown) => void>>();
export function subscribeModelCatalog<T>(command: string, receive: (value: T) => void) {
  const listeners = subscribers.get(command) ?? new Set<(value: unknown) => void>();
  subscribers.set(command, listeners);
  const listener = (value: unknown) => receive(value as T);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(command); };
}
export function publishModelCatalog<T>(command: string, value: T) {
  subscribers.get(command)?.forEach(receive => receive(value));
}
