import { useState } from 'react';
import { blastResetPin } from '@/lib/blast';
import { schools } from '@/lib/client';
import { WriteDialog } from '@/components/write-dialog';
import { ShownOnce } from './shown-once';

/**
 * A new PIN for one person (through admin-api, the LMS lane's own code; owner
 * and ops, with a fresh code). The old PIN stops at once; the new one is shown
 * here once.
 */
export function ResetPin({
  code,
  loginId,
  open,
  onOpenChange,
}: {
  code: string;
  loginId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [made, setMade] = useState<{ loginId: string; displayName: string; pin: string } | null>(null);
  return (
    <>
      <WriteDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Give ${loginId} a new PIN?`}
        blast={blastResetPin(code, loginId)}
        guarded
        confirmLabel='Give a new PIN'
        onConfirm={async (w) => setMade(await schools.resetPin({ code, loginId, ...w }))}
      />
      <ShownOnce open={made !== null} title={made ? `New PIN for ${made.loginId} (${made.displayName})` : ''} onDone={() => setMade(null)}>
        <p className='rounded-md border bg-muted/40 py-6 text-center font-mono text-4xl tracking-widest'>{made?.pin}</p>
      </ShownOnce>
    </>
  );
}
