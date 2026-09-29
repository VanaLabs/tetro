export type OnboardingStep = 1 | 2 | 3;

export type PermissionStatus = 'checking' | 'not_determined' | 'authorized' | 'denied';

export interface OnboardingPermissions {
  microphone: PermissionStatus;
  systemAudio: PermissionStatus;
  screenRecording: PermissionStatus;
}

export interface OnboardingContainerProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  step?: number;
  totalSteps?: number;
  stepOffset?: number;
  hideProgress?: boolean;
  centered?: boolean;
  className?: string;
  showNavigation?: boolean;
  navigationDisabled?: boolean;
  onNext?: () => void;
  onPrevious?: () => void;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
}

export interface PermissionRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: PermissionStatus;
  isPending?: boolean;
  disabled?: boolean;
  actionLabel?: string;
  onAction: () => void;
}

export interface StatusIndicatorProps {
  status: 'idle' | 'checking' | 'success' | 'error';
  size?: 'sm' | 'md' | 'lg';
}
