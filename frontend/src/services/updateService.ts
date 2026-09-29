import { check, type Update } from '@tauri-apps/plugin-updater';
import { getVersion, getName } from '@tauri-apps/api/app';

export interface UpdateInfo {
  available: boolean;
  development?: boolean;
  currentVersion: string;
  version?: string;
  date?: string;
  body?: string;
}
export interface UpdateProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export class UpdateService {
  private lastChecked = 0;
  private pending: Promise<UpdateInfo> | null = null;
  private info: UpdateInfo | null = null;
  private update: Update | null = null;
  private claimed = new WeakSet<Update>();

  wasCheckedRecently(): boolean {
    return this.lastChecked > 0 && Date.now() - this.lastChecked < 6 * 60 * 60 * 1000;
  }

  async checkForUpdates(force = false): Promise<UpdateInfo> {
    if (this.pending) return this.pending;
    if (!force && this.wasCheckedRecently() && this.info) return this.info;
    this.pending = this.performCheck();
    try { return await this.pending; } finally { this.pending = null; }
  }

  private async performCheck(): Promise<UpdateInfo> {
    const currentVersion = await getVersion();
    if (await getName() === 'Tetro Dev') {
      this.lastChecked = Date.now();
      return this.info = { available: false, currentVersion, development: true };
    }
    const next = await check({ timeout: 15000 });
    const previous = this.update;
    // A dialog may already hold downloaded bytes on this resource. Keep it alive
    // across periodic checks, and reuse it when the release has not changed.
    if (next && previous?.version === next.version) {
      await next.close().catch(() => {});
      this.update = previous;
    } else {
      this.update = next;
      if (previous && !this.claimed.has(previous)) await previous.close().catch(() => {});
    }
    this.info = next
      ? { available: true, currentVersion, version: next.version, date: next.date, body: next.body }
      : { available: false, currentVersion };
    this.lastChecked = Date.now();
    return this.info;
  }

  getUpdate(version?: string): Update {
    if (!this.update || this.update.version !== version) {
      throw new Error('Please check for updates again before downloading.');
    }
    this.claimed.add(this.update);
    return this.update;
  }
}
export const updateService = new UpdateService();
