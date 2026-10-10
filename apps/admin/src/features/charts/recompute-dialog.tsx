import { useEffect, useState } from 'react';
import { charts } from '@/lib/client';
import { istToday } from '@/lib/time';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WriteDialog } from '@/components/write-dialog';
import { recomputeBlast, recomputeCheck } from './model';

/**
 * The owner's one write on the chart pages: work out the figures of up to 92
 * India days ending yesterday again (admin.metric_recompute), with a fresh
 * authenticator code, a reason and the environment. The dates start as the
 * page's window; the same rule as the database's is checked before Confirm.
 */
export function RecomputeDialog({
  open,
  onOpenChange,
  from,
  to,
  onDone,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  from: string;
  to: string;
  onDone(): void;
}) {
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  useEffect(() => {
    if (open) {
      setStart(from);
      setEnd(to);
    }
  }, [open, from, to]);
  const check = recomputeCheck(start, end, istToday());

  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Recompute figures'
      blast={recomputeBlast(start, end)}
      guarded
      confirmLabel='Recompute'
      canConfirm={check.ok}
      onConfirm={async (w) => {
        await charts.recompute({ from: start, to: end, ...w });
      }}
      onDone={onDone}
    >
      <div className='grid grid-cols-2 gap-3'>
        <div className='space-y-1'>
          <Label htmlFor='recompute-from'>From</Label>
          <Input id='recompute-from' type='date' value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='recompute-to'>To</Label>
          <Input id='recompute-to' type='date' value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      {!check.ok && (
        <p role='alert' className='text-sm text-destructive'>
          {check.error}
        </p>
      )}
    </WriteDialog>
  );
}
