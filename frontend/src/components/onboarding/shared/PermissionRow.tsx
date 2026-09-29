import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PermissionRowProps } from '@/types/onboarding';
import styles from './PermissionRow.module.css';

export function PermissionRow({ icon, title, description, status, isPending = false, disabled = false, actionLabel, onAction }: PermissionRowProps) {
  const isAuthorized = status === 'authorized';
  const isDenied = status === 'denied';
  const buttonText = isPending ? 'Checking...' : isDenied ? 'Open Settings' : actionLabel || 'Enable';

  return (
    <div className={styles.row} data-authorized={isAuthorized || undefined} data-denied={isDenied || undefined}>
      <div className={styles.details}>
        <span className={styles.icon} aria-hidden="true">{icon}</span>
        <div className={styles.copy}>
          <div className={styles.title}>{title}</div>
          <div className={styles.description}>
            {isAuthorized ? 'Access Granted' : isDenied ? 'Access Denied - Please grant in System Settings' : description}
          </div>
        </div>
      </div>
      <div className={styles.action}>
        {isAuthorized ? (
          <span className={styles.confirmed} aria-hidden="true"><Check strokeWidth={2} /></span>
        ) : (
          <Button
            variant={isDenied ? 'destructive' : 'outline'}
            size="sm"
            onClick={onAction}
            disabled={disabled || isPending}
            className="min-w-[100px]"
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {buttonText}
          </Button>
        )}
      </div>
    </div>
  );
}
