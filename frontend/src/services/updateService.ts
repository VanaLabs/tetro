/**
 * Update Service
 *
 * Handles automatic software updates using Tauri updater plugin.
 * Provides update checking, downloading, and installation functionality.
 */

import type { Update } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  date?: string;
  body?: string;
  downloadUrl?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

/**
 * Update Service
 * Singleton service for managing app updates
 */
export class UpdateService {
  // A Tetro release channel must be configured before packaged updates are enabled.
  async checkForUpdates(_force = false): Promise<UpdateInfo> {
    return { available: false, currentVersion: await getVersion(), body: 'Tetro development builds update from source.' };
  }
  async downloadAndInstall(_update: Update, _onProgress?: (progress: UpdateProgress) => void): Promise<void> {
    throw new Error('Tetro has no signed release channel configured. Use the development launcher.');
  }
  async getCurrentVersion(): Promise<string> { return getVersion(); }
  wasCheckedRecently(): boolean { return true; }
}

// Export singleton instance
export const updateService = new UpdateService();
