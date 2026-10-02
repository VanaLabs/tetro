import React from 'react';
import { ChevronLeft, ChevronRight, Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProgressIndicator } from './shared/ProgressIndicator';
import { useOnboarding } from '@/contexts/OnboardingContext';
import type { OnboardingContainerProps } from '@/types/onboarding';
import { useTheme } from '@/contexts/ThemeContext';
import styles from './OnboardingContainer.module.css';

export function OnboardingContainer({
  title,
  description,
  children,
  footer,
  step,
  totalSteps = 5,
  stepOffset = 0,
  hideProgress = false,
  centered = false,
  className,
  showNavigation = false,
  navigationDisabled = false,
  onNext,
  onPrevious,
  canGoNext = true,
  canGoPrevious = true,
}: OnboardingContainerProps) {
  const { goToStep, goPrevious, goNext } = useOnboarding();
  const { theme, setTheme } = useTheme();

  const handlePrevious = () => {
    if (onPrevious) {
      onPrevious();
    } else {
      goPrevious();
    }
  };

  const handleNext = () => {
    if (onNext) {
      onNext();
    } else {
      goNext();
    }
  };

  const handleStepClick = (s: number) => {
    goToStep(s + stepOffset);
  };

  return (
    <div className={cn("fixed inset-0 bg-gray-50 flex items-center justify-center z-50 overflow-hidden", styles.viewport)}>
      <div className={styles.themePicker} role="group" aria-label="Appearance">
        <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
          <Sun size={16} aria-hidden="true" /> Light
        </button>
        <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
          <Moon size={16} aria-hidden="true" /> Dark
        </button>
      </div>
      <div className={cn(styles.shell, className)} data-step={step}>
        {/* Progress Indicator with Navigation - Fixed */}
        {step && !hideProgress && (
          <div className={styles.progress}>
            {/* Navigation Buttons */}
            {showNavigation && (
              <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 flex justify-between pointer-events-none">
                <button
                  type="button"
                  aria-label="Back to previous setup step"
                  onClick={handlePrevious}
                  disabled={!canGoPrevious || step === 1}
                  className={cn(
                    'pointer-events-auto w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center transition-all duration-200',
                    canGoPrevious && step !== 1
                      ? 'hover:bg-gray-50 hover:shadow-md hover:scale-110 text-gray-700'
                      : 'opacity-0 cursor-not-allowed'
                  )}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  aria-label="Continue to next setup step"
                  onClick={handleNext}
                  disabled={!canGoNext || step === totalSteps}
                  className={cn(
                    'pointer-events-auto w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center transition-all duration-200',
                    canGoNext && step !== totalSteps
                      ? 'hover:bg-gray-50 hover:shadow-md hover:scale-110 text-gray-700'
                      : 'opacity-0 cursor-not-allowed'
                  )}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Progress Indicator */}
            <ProgressIndicator current={step} total={totalSteps} onStepClick={navigationDisabled ? undefined : handleStepClick} />
          </div>
        )}

        {/* Header - Fixed */}
        <div className={styles.header}>
          <h1 className={styles.heading}>{title}</h1>
          {description && (
            <p className={styles.description}>
              {description}
            </p>
          )}
        </div>

        {/* Content - Scrollable */}
        <div className={cn(styles.content, centered && styles.centeredContent)}>
          <div className="space-y-6">{children}</div>
        </div>
        {footer && <div className={styles.footer}><div className={styles.footerInner}>{footer}</div></div>}
      </div>
    </div>
  );
}
