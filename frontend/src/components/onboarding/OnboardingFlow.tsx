import React, { useEffect } from 'react';
import { useOnboarding } from '@/contexts/OnboardingContext';
import {
  WelcomeStep,
  PermissionsStep,
  DownloadProgressStep,
} from './steps';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { currentStep } = useOnboarding();
  const [isMac, setIsMac] = React.useState<boolean | null>(null);

  useEffect(() => {
    // Check if running on macOS
    // The OS plugin isn't registered in the native app, so read its data only when present
    // and otherwise fall back to the WebView's user agent (always "Macintosh" on macOS).
    const checkPlatform = () => {
      const os = (window as unknown as { __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: string } }).__TAURI_OS_PLUGIN_INTERNALS__;
      setIsMac(os?.platform ? os.platform === 'macos' : /Mac/.test(navigator.userAgent));
    };
    checkPlatform();
  }, []);

  // Step 1: Welcome
  // Step 2: Choose starter models. Step 3: macOS recording permissions.

  if (isMac === null) return null;

  return (
    <div className="onboarding-flow">
      {currentStep === 1 && <WelcomeStep totalSteps={isMac ? 3 : 2} />}
      {currentStep === 2 && <DownloadProgressStep isMac={isMac} />}
      {currentStep === 3 && isMac && <PermissionsStep />}
    </div>
  );
}
