import { useEffect, useState } from 'react';
import { blastLicence } from '@/lib/blast';
import { schools } from '@/lib/client';
import { addDays, istToday } from '@/lib/time';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WriteDialog } from '@/components/write-dialog';

/** The school's licence (admin.school_set_licence over lms.set_licence; the owner, with a fresh code). */
export function SetLicence({
  code,
  current,
  seatsUsed,
  open,
  onOpenChange,
  onDone,
}: {
  code: string;
  current: { plan: string; seats: number; validUntil: string } | null;
  seatsUsed: number;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  const [plan, setPlan] = useState('');
  const [seats, setSeats] = useState('');
  const [until, setUntil] = useState('');

  useEffect(() => {
    if (open) {
      setPlan(current?.plan ?? 'pilot');
      setSeats(String(current?.seats ?? Math.max(seatsUsed, 50)));
      setUntil(current?.validUntil ?? addDays(istToday(), 365));
    }
  }, [open, current, seatsUsed]);

  const word = plan.trim().toLowerCase();
  const n = Number(seats);
  const ready = /^[a-z][a-z0-9-]{0,29}$/.test(word) && Number.isInteger(n) && n >= 1 && n <= 100000 && /^\d{4}-\d{2}-\d{2}$/.test(until);

  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Set ${code}'s licence`}
      blast={blastLicence(code, word || 'PLAN', ready ? n : 0, until || 'DATE', seatsUsed)}
      guarded
      confirmLabel='Set the licence'
      canConfirm={ready}
      onConfirm={(w) => schools.setLicence({ code, plan: word, seats: n, validUntil: until, ...w })}
      onDone={onDone}
    >
      <div className='grid gap-3 sm:grid-cols-3'>
        <div className='space-y-1'>
          <Label htmlFor='licence-plan'>Plan</Label>
          <Input id='licence-plan' value={plan} onChange={(e) => setPlan(e.target.value)} placeholder='pilot' />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='licence-seats'>Seats</Label>
          <Input id='licence-seats' type='number' min={1} max={100000} value={seats} onChange={(e) => setSeats(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='licence-until'>Last day</Label>
          <Input id='licence-until' type='date' value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
      </div>
    </WriteDialog>
  );
}
