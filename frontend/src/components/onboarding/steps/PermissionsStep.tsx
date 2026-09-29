import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Mic, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { PermissionRow } from '../shared';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { toast } from 'sonner';

type PendingPermission = 'microphone' | 'systemAudio' | null;

export function PermissionsStep() {
  const { setPermissionStatus, setPermissionsSkipped, permissions, completeOnboarding } = useOnboarding();
  const [pending, setPending] = useState<PendingPermission>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const sound = useRef<HTMLAudioElement | null>(null);
  const [audioMessage, setAudioMessage] = useState('');
  const [audioAttempted, setAudioAttempted] = useState(false);

  // Reading status never requests access. Refresh microphone after System Settings;
  // system audio can only be verified by an explicit capture test.
  useEffect(() => {
    mounted.current = true;
    const refresh = async () => {
      if (busy.current) return;
      try {
        const snapshot = await invoke<{ platform: string; microphone: string }>('get_app_permissions');
        if (!mounted.current || busy.current || snapshot.platform !== 'macos') return;
        setPermissionStatus('microphone', snapshot.microphone === 'granted' ? 'authorized'
          : ['denied', 'restricted'].includes(snapshot.microphone) ? 'denied' : 'not_determined');
      } catch { /* A failed status read must not claim authorization or denial. */ }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', refresh);
      sound.current?.pause();
      sound.current = null;
    };
  }, [setPermissionStatus]);

  const openSettings = async (permission: 'microphone' | 'system_audio') => {
    try { await invoke('open_app_permission_settings', { permission }); }
    catch { toast.warning('Could not open System Settings', { description: 'Open Privacy & Security in System Settings to manage Tetro’s access.' }); }
  };

  const handleMicrophoneAction = async () => {
    if (busy.current) return;
    if (permissions.microphone === 'denied') { await openSettings('microphone'); return; }
    busy.current = true;
    setPending('microphone');
    try {
      const snapshot = await invoke<{ platform: string }>('get_app_permissions');
      if (snapshot.platform === 'macos') {
        const status = await invoke<string>('request_app_permission', { permission: 'microphone' });
        if (mounted.current) setPermissionStatus('microphone', status === 'granted' ? 'authorized'
          : ['denied', 'restricted'].includes(status) ? 'denied' : 'not_determined');
      } else {
        const granted = await invoke<boolean>('trigger_microphone_permission');
        if (mounted.current) setPermissionStatus('microphone', granted ? 'authorized' : 'denied');
      }
    } catch {
      if (mounted.current) {
        setPermissionStatus('microphone', 'not_determined');
        toast.warning('Could not check microphone access', { description: 'Please try again.' });
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  };

  const handleSystemAudioAction = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending('systemAudio');
    setAudioAttempted(true);
    setAudioMessage('Allow access when macOS asks. Tetro checks audio automatically with a quiet sound; nothing is saved.');
    // Discard any stale UI flag. Only actual captured audio proves access.
    setPermissionStatus('systemAudio', 'not_determined');
    // Start playback inside the Enable click's user gesture (required by WebKit).
    // The quiet coin sound includes silence between repeats. Loop until capture sees audio so
    // accepting a delayed OS prompt needs no second click or external audio.
    const audio = new Audio('/tetro/audio-access-test.wav');
    audio.loop = true;
    sound.current = audio;
    void audio.play().catch(() => {
      // Permission/capture is still checked below; playback failure is never proof
      // of denial and must not report authorization.
      if (mounted.current && sound.current === audio) setAudioMessage('The automatic audio check couldn’t play. Please wait for the check to finish, then try again.');
    });
    let verified = false;
    try {
      const result = await invoke<string>('trigger_system_audio_permission_command');
      verified = result === 'verified' || result === 'not_required';
      if (!mounted.current) return;
      if (verified) {
        setPermissionStatus('systemAudio', 'authorized');
        setAudioMessage('');
      } else {
        setAudioMessage('We couldn’t confirm system audio access. Allow Tetro in System Settings, then try again.');
      }
    } catch {
      if (mounted.current) setAudioMessage('The audio check couldn’t start. Check Tetro’s audio access in System Settings, then retry.');
    } finally {
      if (verified && sound.current) {
        // Finish the current coin sound without another repeat. Capture itself
        // has already stopped; unmount still stops playback immediately.
        sound.current.loop = false;
      } else {
        sound.current?.pause();
        sound.current = null;
      }
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  };

  const handleFinish = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await completeOnboarding();
      window.location.reload();
    } catch {
      toast.error('Could not finish setup', { description: 'Please try again.' });
    } finally { busy.current = false; }
  };

  const handleSkip = async () => {
    if (busy.current) return;
    setPermissionsSkipped(true);
    await handleFinish();
  };

  const allPermissionsGranted = permissions.microphone === 'authorized' && permissions.systemAudio === 'authorized';

  return (
    <OnboardingContainer
      title="Recording permissions"
      description="Allow microphone and computer audio access to record meetings. You can do this later."
      step={3}
      totalSteps={3}
      navigationDisabled={pending !== null}
      footer={<div className="flex flex-col gap-3">
        <Button onClick={handleFinish} disabled={!allPermissionsGranted || pending !== null} className="w-full h-11 tetro-key tetro-key-amber">
          Finish Setup
        </Button>
        <button onClick={handleSkip} disabled={pending !== null} className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors disabled:opacity-50">
          I&apos;ll do this later
        </button>
        {!allPermissionsGranted && <p className="text-xs text-center text-muted-foreground">
          Recording won&apos;t work without permissions. You can grant them later in settings.
        </p>}
      </div>}
    >
      <div className="max-w-lg mx-auto space-y-6">
        <div className="space-y-4">
          <PermissionRow
            icon={<Mic className="w-5 h-5" />}
            title="Microphone"
            description="Required to capture your voice during meetings"
            status={permissions.microphone}
            isPending={pending === 'microphone'}
            disabled={pending !== null}
            onAction={handleMicrophoneAction}
          />
          <PermissionRow
            icon={<Volume2 className="w-5 h-5" />}
            title="System Audio"
            description="Required to capture other people’s voices and computer audio."
            status={permissions.systemAudio}
            isPending={pending === 'systemAudio'}
            disabled={pending !== null}
            actionLabel={audioAttempted ? 'Try again' : 'Enable'}
            onAction={handleSystemAudioAction}
          />
          {audioMessage && <div className="space-y-3">
            <p role="status" className="text-sm text-neutral-700">{audioMessage}</p>
            <div className="flex flex-wrap gap-3">
              {pending === null && <Button variant="outline" onClick={() => openSettings('system_audio')}>Open System Settings</Button>}
            </div>
          </div>}
        </div>
      </div>
    </OnboardingContainer>
  );
}
