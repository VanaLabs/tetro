'use client';

import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTheme } from '@/contexts/ThemeContext';

/** Desktop translucency is available only in the macOS native window. */
export function NativeGlass() {
  const { theme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    const enabled = isTauri() && navigator.platform.startsWith('Mac');
    root.classList.toggle('tetro-native-glass', enabled);
    return () => root.classList.remove('tetro-native-glass');
  }, []);

  useEffect(() => {
    if (!isTauri() || !navigator.platform.startsWith('Mac')) return;
    // Keep native title text and traffic lights legible on the app's chrome.
    void getCurrentWindow().setTheme(theme).catch(error => {
      console.warn('Could not match the native window theme:', error);
    });
  }, [theme]);

  return <div className="tetro-native-titlebar" data-tauri-drag-region aria-hidden="true" />;
}
