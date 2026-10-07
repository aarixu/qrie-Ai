import type { RelayStatus } from '@ai-tutor/admin-client';
import { useEffect, useState } from 'react';
import { blastCeiling } from '@/lib/blast';
import { admin } from '@/lib/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WriteDialog } from '@/components/write-dialog';

const MIN_UNITS = 1000;
const MAX_UNITS = 1_000_000;

/**
 * The tutor's daily spending ceiling, in meter units (admin.set_caps; the
 * owner, with a fresh code). A raise lasts the UTC day and goes back by
 * itself; a cut to or below today's spend is refused unless the tutor is
 * stopped.
 */
export function CeilingDialog({
  status,
  open,
  onOpenChange,
  onDone,
}: {
  status: RelayStatus;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText(String(status.ceilingUnits));
  }, [open, status.ceilingUnits]);

  const units = Number(text);
  const ready = Number.isInteger(units) && units >= MIN_UNITS && units <= MAX_UNITS && units !== status.ceilingUnits;
  const revertsTo = status.capOverride?.previousUnits ?? status.ceilingUnits;

  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Change the daily ceiling'
      blast={ready ? blastCeiling(units, status.ceilingUnits, status.unitsToday, revertsTo) : `The ceiling is ${status.ceilingUnits} units now.`}
      guarded
      destructive={ready && units <= status.unitsToday}
      confirmLabel='Change the ceiling'
      canConfirm={ready}
      onConfirm={(w) => admin.setCaps(units, w.reason, w.env)}
      onDone={onDone}
    >
      <div className='space-y-1'>
        <Label htmlFor='ceiling-units'>
          Units a day ({MIN_UNITS.toLocaleString('en-IN')} to {MAX_UNITS.toLocaleString('en-IN')})
        </Label>
        <Input
          id='ceiling-units'
          type='number'
          min={MIN_UNITS}
          max={MAX_UNITS}
          step={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className='text-xs text-muted-foreground'>Today so far: {status.unitsToday} units. Units are the meter&apos;s, not rupees.</p>
      </div>
    </WriteDialog>
  );
}
