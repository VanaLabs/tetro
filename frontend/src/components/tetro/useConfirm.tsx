'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type ConfirmOptions = { title: string; body: ReactNode; confirm: string; danger?: boolean };

/** Promise-based confirmation dialog: `if (await confirm({...})) doIt()`. Render `dialog` once. */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(ok: boolean) => void>();
  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>(resolve => { resolver.current = resolve; setOptions(next); }), []);
  const close = (ok: boolean) => { resolver.current?.(ok); resolver.current = undefined; setOptions(null); };
  const dialog = <Dialog open={!!options} onOpenChange={open => { if (!open) close(false); }}>
    <DialogContent>
      <DialogTitle>{options?.title}</DialogTitle>
      <DialogDescription asChild><div>{options?.body}</div></DialogDescription>
      <div className="tetro-dialog-actions">
        <button onClick={() => close(false)} autoFocus>Cancel</button>
        <button className={options?.danger === false ? 'tetro-primary' : 'tetro-danger'} onClick={() => close(true)}>{options?.confirm}</button>
      </div>
    </DialogContent>
  </Dialog>;
  return { confirm, dialog };
}
