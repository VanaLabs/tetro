import { useCallback, useEffect, useRef, useState } from 'react';
import { updateService, UpdateInfo } from '@/services/updateService';
import { showUpdateNotification } from '@/components/UpdateNotification';
import { toast } from 'sonner';

interface UseUpdateCheckOptions {
  checkOnMount?: boolean;
  showNotification?: boolean;
  onUpdateAvailable?: (info: UpdateInfo) => void;
}

export function useUpdateCheck(options: UseUpdateCheckOptions = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const checkForUpdates = useCallback(async (force = false) => {
    if (!force && updateService.wasCheckedRecently()) return;
    setIsChecking(true);
    try {
      const info = await updateService.checkForUpdates(force);
      setUpdateInfo(info);
      if (info.available) {
        if (optionsRef.current.onUpdateAvailable) optionsRef.current.onUpdateAvailable(info);
        else if (optionsRef.current.showNotification !== false) showUpdateNotification(info);
      } else if (force) toast.success('Tetro is up to date.');
    } catch (error) {
      setUpdateInfo(null);
      if (force) toast.error('Could not check for updates. Try again later.', { description: String(error) });
    } finally {
      setIsChecking(false);
    }
  }, []);

  const checkOnMount = options.checkOnMount !== false;
  useEffect(() => {
    if (!checkOnMount) return;
    const timer = setTimeout(() => void checkForUpdates(), 2000);
    const interval = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [checkOnMount, checkForUpdates]);

  return { updateInfo, isChecking, checkForUpdates };
}
