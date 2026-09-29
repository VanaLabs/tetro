import { beforeEach, expect, mock, test } from 'bun:test';
let appName = 'Tetro';
const check = mock(async (): Promise<any> => null);
mock.module('@tauri-apps/plugin-updater', () => ({ check }));
mock.module('@tauri-apps/api/app', () => ({ getVersion: async () => '0.4.1', getName: async () => appName }));
const { UpdateService } = await import('../../src/services/updateService');
beforeEach(() => { appName = 'Tetro'; check.mockReset(); check.mockResolvedValue(null); });
test('first check runs, caches success, and manual checks bypass the interval', async () => {
  const service = new UpdateService();
  expect(service.wasCheckedRecently()).toBe(false);
  expect(await service.checkForUpdates()).toEqual({ available: false, currentVersion: '0.4.1' });
  await service.checkForUpdates();
  expect(check).toHaveBeenCalledTimes(1);
  await service.checkForUpdates(true);
  expect(check).toHaveBeenCalledTimes(2);
});
test('network failures are not reported or cached as up to date', async () => {
  const service = new UpdateService();
  check.mockRejectedValueOnce(new Error('404'));
  await expect(service.checkForUpdates()).rejects.toThrow('404');
  expect(service.wasCheckedRecently()).toBe(false);
  await service.checkForUpdates();
  expect(check).toHaveBeenCalledTimes(2);
});
test('checks never download, install, or relaunch; selected version must match', async () => {
  const update = { version: '0.4.2', body: 'Changes', close: mock(async () => {}), download: mock(), install: mock() };
  check.mockResolvedValue(update);
  const service = new UpdateService();
  expect((await service.checkForUpdates()).available).toBe(true);
  expect(Object.is(service.getUpdate('0.4.2'), update)).toBe(true);
  expect(() => service.getUpdate('0.4.3')).toThrow();
  expect(update.download).not.toHaveBeenCalled();
  expect(update.install).not.toHaveBeenCalled();
});
test('concurrent checks share a single network request', async () => {
  const service = new UpdateService();
  await Promise.all([service.checkForUpdates(), service.checkForUpdates(true)]);
  expect(check).toHaveBeenCalledTimes(1);
});
test('periodic checks keep a downloaded resource usable until restart', async () => {
  const first = { version: '0.4.2', close: mock(async () => {}) };
  const repeated = { version: '0.4.2', close: mock(async () => {}) };
  check.mockResolvedValueOnce(first).mockResolvedValueOnce(repeated).mockResolvedValueOnce({ version: '0.4.3', close: mock(async () => {}) });
  const service = new UpdateService();
  await service.checkForUpdates();
  service.getUpdate('0.4.2');
  await service.checkForUpdates(true);
  expect(Object.is(service.getUpdate('0.4.2'), first)).toBe(true);
  expect(repeated.close).toHaveBeenCalledTimes(1);
  await service.checkForUpdates(true);
  expect(first.close).not.toHaveBeenCalled();
});

test('dev app never checks the consumer update feed or exposes an installable update', async () => {
  appName = 'Tetro Dev';
  const service = new UpdateService();
  expect(await service.checkForUpdates(true)).toEqual({ available: false, currentVersion: '0.4.1', development: true });
  expect(check).not.toHaveBeenCalled();
  expect(() => service.getUpdate()).toThrow();
});
