'use client';

import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';

/** Desktop translucency is available only in the macOS native window. */
export function NativeGlass() {
  useEffect(() => {
    const root = document.documentElement;
    const enabled = isTauri() && navigator.platform.startsWith('Mac');
    root.classList.toggle('tetro-native-glass', enabled);
    return () => root.classList.remove('tetro-native-glass');
  }, []);

  return null;
}
