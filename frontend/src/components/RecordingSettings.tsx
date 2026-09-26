import { ShortcutSettings } from '@/components/tetro/ShortcutSettings';
import { Segmented, SettingGroup, SettingRow, shortPath } from '@/components/tetro/SettingRow';
import { formatFolderName, formatMeetingName, setNameFormat, type DateOrder } from '@/lib/meetingName';
import React, { useState, useEffect, useRef } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';

import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  name_date_order?: DateOrder | null;
  name_time_first?: boolean | null;
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null,
    name_date_order: 'ymd',
    name_time_first: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const saveInFlight = useRef(false);
  const { isRecording } = useRecordingState();
  const { setSelectedDevices } = useConfig();

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        setLoadError(true);
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, auto_save: enabled };
    await savePreferences(newPreferences);

    // Track auto-save setting change

  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    // Sync the in-memory selection ConfigContext exposes to the start path.
    // Without this, the picker only writes to disk (loaded into context once at
    // app mount), so a newly-chosen mic isn't honored until the next launch —
    // start keeps sending the stale launch-time device.
    await savePreferences(newPreferences);

    // Track default device preference changes

  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
      toast.error('Couldn’t open the recording folder', { description: String(error) });
    }
  };

  const handleNameFormat = async (patch: Partial<RecordingPreferences>) => {
    const next = { ...preferences, ...patch };
    await savePreferences(next);
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    if (saveInFlight.current || loadError) return;
    saveInFlight.current = true;
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      setPreferences(prefs);
      setNameFormat({ order: prefs.name_date_order ?? 'ymd', timeFirst: prefs.name_time_first ?? false });
      setSelectedDevices({ micDevice: prefs.preferred_mic_device, systemDevice: prefs.preferred_system_device });
      onSave?.(prefs);
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error("Couldn’t save recording preferences", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-gray-200 rounded mb-4"></div>
      </div>
    );
  }

  if (loadError) return <p role="alert">Couldn’t load your recording preferences. Reopen this section to try again. Your saved preferences have not changed.</p>;

  const order = preferences.name_date_order ?? 'ymd';
  const timeFirst = preferences.name_time_first ?? false;
  const sample = new Date();

  return (
    <div className="tetro-settings-stack">
      <SettingGroup title="Audio files">
        <SettingRow label="Save audio" hint="Keep an audio file next to each transcript.">
          <Switch checked={preferences.auto_save} onCheckedChange={handleAutoSaveToggle} disabled={saving} aria-label="Save audio" />
        </SettingRow>
        {preferences.auto_save && <SettingRow label="Save location" hint={<span className="tetro-path" title={preferences.save_folder}>{shortPath(preferences.save_folder) || 'Default folder'} · {preferences.file_format.toUpperCase()} files</span>}>
          <button className="tetro-key" onClick={handleOpenFolder}><FolderOpen className="w-4 h-4" />Open</button>
        </SettingRow>}
      </SettingGroup>

      <SettingGroup title="Naming">
        <SettingRow label="Date order">
          <Segmented disabled={saving} label="Date order" value={order} onChange={value => void handleNameFormat({ name_date_order: value })} options={[
            { value: 'dmy', label: 'Day first' }, { value: 'mdy', label: 'Month first' }, { value: 'ymd', label: 'Year first' },
          ]} />
        </SettingRow>
        <SettingRow label="Time">
          <Segmented disabled={saving} label="Time position" value={timeFirst ? 'first' : 'last'} onChange={value => void handleNameFormat({ name_time_first: value === 'first' })} options={[
            { value: 'last', label: 'After the date' }, { value: 'first', label: 'Before the date' },
          ]} />
        </SettingRow>
        <div className="tetro-name-preview" aria-live="polite">
          <span>New meetings</span><b>{formatMeetingName(sample, { order, timeFirst })}</b>
          <span>Folder</span><code>{formatFolderName(sample, { order, timeFirst })}</code>
        </div>
      </SettingGroup>

      <ShortcutSettings />

      <SettingGroup title="Default devices">
        {isRecording && <p role="status" aria-live="polite" className="tetro-setting-note">Devices are locked while recording. Stop the recording to change them.</p>}
        <div className="tetro-device-block">
          <DeviceSelection
            selectedDevices={{ micDevice: preferences.preferred_mic_device, systemDevice: preferences.preferred_system_device }}
            onDeviceChange={handleDeviceChange}
            disabled={saving || isRecording}
          />
        </div>
      </SettingGroup>
    </div>
  );
}
