import { useEffect, useState } from 'react';
import { blastQuiet } from '@/lib/blast';
import { schools } from '@/lib/client';
import { addDays, istToday } from '@/lib/time';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WriteDialog } from '@/components/write-dialog';

/**
 * A holiday: the health card's teaching, learning, attendance and last-active
 * signals read grey until that day (admin.school_quiet_set; owner and ops).
 * `clear` ends a holiday instead.
 */
export function SetQuiet({
  code,
  clear,
  open,
  onOpenChange,
  onDone,
}: {
  code: string;
  clear: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  const today = istToday();
  const [until, setUntil] = useState('');
  useEffect(() => {
    if (open) setUntil(addDays(istToday(), 7));
  }, [open]);
  const ready = clear || (until >= today && until <= addDays(today, 90));
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={clear ? `End ${code}'s holiday?` : `${code} is on holiday until…`}
      blast={blastQuiet(code, clear ? null : until)}
      confirmLabel={clear ? 'Clear' : 'Save'}
      canConfirm={ready}
      onConfirm={(w) => schools.setQuiet({ code, until: clear ? null : until, ...w })}
      onDone={onDone}
    >
      {!clear && (
        <div className='space-y-1'>
          <Label htmlFor='quiet-until'>Last day of the holiday (today to 90 days ahead)</Label>
          <Input id='quiet-until' type='date' min={today} max={addDays(today, 90)} value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
      )}
    </WriteDialog>
  );
}
