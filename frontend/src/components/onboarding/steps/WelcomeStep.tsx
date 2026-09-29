import React from 'react';
import { TetroBrand } from '@/components/tetro/TetroBrand';
import { FileDown, Languages, ListChecks, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import styles from './WelcomeStep.module.css';

export function WelcomeStep({ totalSteps }: { totalSteps: number }) {
  const { goNext } = useOnboarding();

  const features = [
    { icon: ShieldCheck, title: 'Privacy first', text: 'Everything runs on local models, so nothing leaves your device. Private enough for therapy sessions.' },
    { icon: FileDown, title: 'Easy export', text: 'Save transcripts and summaries as PDF or Markdown to share.' },
    { icon: ListChecks, title: 'Action items in one place', text: 'Action items from your summaries collect in one list you can check off.' },
    { icon: Languages, title: 'Models for your language', text: 'Choose local models by language, including ones built for Armenian.' },
  ];

  return (
    <OnboardingContainer
      title={
        <>
          <span className={styles.greeting}>Welcome to</span>
          <span className={styles.brandLine}>
            <TetroBrand variant="welcome" />
            <span className="sr-only">Tetro</span>
          </span>
        </>
      }
      description="Record, transcribe and summarize your meetings, privately on your device."
      step={1}
      totalSteps={totalSteps}
      centered={true}
      footer={<Button onClick={goNext} className="w-full h-11 tetro-key tetro-key-amber">Get started</Button>}
    >
      <div className="tetro-welcome-features">
        {features.map(({ icon: Icon, title, text }) => (
          <div key={title} className="tetro-welcome-feature">
            <span aria-hidden="true"><Icon /></span>
            <div><strong>{title}</strong><p>{text}</p></div>
          </div>
        ))}
      </div>
    </OnboardingContainer>
  );
}
