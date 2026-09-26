import React, { useEffect, useState } from 'react';
import { Mic, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function SetupOverviewStep() {
  const { goNext } = useOnboarding();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };
    void checkPlatform();
  }, []);

  return (
    <OnboardingContainer
      title="Set up local models"
      description="Start with the smallest speech model. Local AI notes are optional."
      step={2}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-start gap-3">
            <Mic className="mt-0.5 h-5 w-5 text-gray-700" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-gray-900">Transcription · about 74 MiB</h2>
              <p className="mt-1 text-sm text-gray-600">Whisper Tiny is included with the desktop app. It is fast but less accurate than larger models. If it is missing, Tetro will ask before downloading it.</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-gray-700" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-gray-900">Local notes · about 1.0 GiB</h2>
              <p className="mt-1 text-sm text-gray-600">Choose whether to download Gemma 3 1B now. You can record and edit transcripts without it.</p>
            </div>
          </div>
        </div>
        <Button onClick={goNext} className="w-full tetro-key tetro-key-amber">Choose models</Button>
      </div>
    </OnboardingContainer>
  );
}
