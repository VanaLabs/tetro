"use client"

import { useEffect, useState, useRef } from "react"
import { Switch } from "./ui/switch"
import { FolderOpen, Monitor, Moon, Sun } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"

import { useConfig, NotificationSettings } from "@/contexts/ConfigContext"
import { useTheme } from "@/contexts/ThemeContext"
import { Segmented, SettingGroup, SettingRow, shortPath } from "@/components/tetro/SettingRow"

export function PreferenceSettings() {
  const {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings
  } = useConfig();
  const { preference, setPreference } = useTheme();

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [previousNotificationsEnabled, setPreviousNotificationsEnabled] = useState<boolean | null>(null);
  useEffect(() => { void loadPreferences(); }, [loadPreferences]);

  // Update notificationsEnabled when notificationSettings are loaded from global state
  useEffect(() => {
    if (notificationSettings) {
      // Notification enabled means both started and stopped notifications are enabled
      const enabled =
        notificationSettings.notification_preferences.show_recording_started &&
        notificationSettings.notification_preferences.show_recording_stopped;
      setNotificationsEnabled(enabled);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(enabled);
        setIsInitialLoad(false);
      }
    } else if (!isLoadingPreferences) {
      // If not loading and no settings, use default
      setNotificationsEnabled(true);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(true);
        setIsInitialLoad(false);
      }
    }
  }, [notificationSettings, isLoadingPreferences, isInitialLoad])

  useEffect(() => {
    // Skip update on initial load or if value hasn't actually changed
    if (isInitialLoad || notificationsEnabled === null || notificationsEnabled === previousNotificationsEnabled) return;
    if (!notificationSettings) return;

    const handleUpdateNotificationSettings = async () => {
      console.log("Updating notification settings to:", notificationsEnabled);

      try {
        // Update the notification preferences
        const updatedSettings: NotificationSettings = {
          ...notificationSettings,
          notification_preferences: {
            ...notificationSettings.notification_preferences,
            show_recording_started: notificationsEnabled,
            show_recording_stopped: notificationsEnabled,
          }
        };

        console.log("Calling updateNotificationSettings with:", updatedSettings);
        await updateNotificationSettings(updatedSettings);
        setPreviousNotificationsEnabled(notificationsEnabled);
        console.log("Successfully updated notification settings to:", notificationsEnabled);

        // Track notification preference change - only fires when user manually toggles

      } catch (error) {
        console.error('Failed to update notification settings:', error);
      }
    };

    handleUpdateNotificationSettings();
  }, [notificationsEnabled, notificationSettings, isInitialLoad, previousNotificationsEnabled, updateNotificationSettings])

  const handleOpenFolder = async (folderType: 'database' | 'models' | 'recordings') => {
    try {
      switch (folderType) {
        case 'database':
          await invoke('open_database_folder');
          break;
        case 'models':
          await invoke('open_models_folder');
          break;
        case 'recordings':
          await invoke('open_recordings_folder');
          break;
      }

      // Track storage folder access

    } catch (error) {
      console.error(`Failed to open ${folderType} folder:`, error);
    }
  };

  // Show loading only if we're actually loading and don't have cached data
  if (isLoadingPreferences && !notificationSettings && !storageLocations) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>
  }

  // Show loading if notificationsEnabled hasn't been determined yet
  if (notificationsEnabled === null && !isLoadingPreferences) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>
  }

  // Ensure we have a boolean value for the Switch component
  const notificationsEnabledValue = notificationsEnabled ?? false;

  return (
    <div className="tetro-settings-stack">
      <SettingGroup title="App">
        <SettingRow label="Appearance">
          <Segmented label="Appearance" value={preference} onChange={setPreference} options={[
            { value: 'light', label: <><Sun className="h-3.5 w-3.5" aria-hidden="true" />Light</> },
            { value: 'dark', label: <><Moon className="h-3.5 w-3.5" aria-hidden="true" />Dark</> },
            { value: 'system', label: <><Monitor className="h-3.5 w-3.5" aria-hidden="true" />System</> },
          ]} />
        </SettingRow>
        <SettingRow label="Notifications" hint="A system notification when a recording starts and stops.">
          <Switch checked={notificationsEnabledValue} onCheckedChange={setNotificationsEnabled} aria-label="Notifications" />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Storage">
        <SettingRow label="Recordings folder" hint={<span className="tetro-path" title={storageLocations?.recordings}>{shortPath(storageLocations?.recordings) || 'Loading…'}</span>}>
          <button className="tetro-key" onClick={() => handleOpenFolder('recordings')}><FolderOpen className="w-4 h-4" />Open</button>
        </SettingRow>
      </SettingGroup>
    </div>
  )
}
