import { useEffect, useState } from 'react';
import { blastCreate } from '@/lib/blast';
import { schools } from '@/lib/client';
import { academicYear, istToday } from '@/lib/time';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WriteDialog } from '@/components/write-dialog';

const BOARDS = ['CBSE', 'ICSE', 'STATE', 'OTHER'] as const;

/** A new, empty school with its first year (admin.school_create; owner and ops). */
export function CreateSchool({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(code: string): void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [board, setBoard] = useState<string>('CBSE');
  const [year, setYear] = useState(() => academicYear(istToday()));

  useEffect(() => {
    if (open) {
      setCode('');
      setName('');
      setBoard('CBSE');
      setYear(academicYear(istToday()));
    }
  }, [open]);

  const cleanCode = code.trim().toUpperCase();
  const ready = /^[A-Z0-9]{3,12}$/.test(cleanCode) && name.trim().length > 0 && year.label.trim().length > 0 && year.startsOn < year.endsOn;

  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Create a school'
      blast={blastCreate(cleanCode || 'CODE', year.label || 'YEAR')}
      confirmLabel='Create the school'
      canConfirm={ready}
      onConfirm={async (w) => {
        await schools.create({ code: cleanCode, name: name.trim(), board, yearLabel: year.label.trim(), startsOn: year.startsOn, endsOn: year.endsOn, ...w });
      }}
      onDone={() => onCreated(cleanCode)}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label htmlFor='school-code'>Code</Label>
          <Input id='school-code' value={code} onChange={(e) => setCode(e.target.value)} placeholder='3 to 12 letters or digits' className='font-mono uppercase' />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='school-board'>Board</Label>
          <Select value={board} onValueChange={setBoard}>
            <SelectTrigger id='school-board' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOARDS.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1 sm:col-span-2'>
          <Label htmlFor='school-name'>Name</Label>
          <Input id='school-name' value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='school-year'>Year</Label>
          <Input id='school-year' value={year.label} onChange={(e) => setYear({ ...year, label: e.target.value })} maxLength={20} />
        </div>
        <div />
        <div className='space-y-1'>
          <Label htmlFor='school-starts'>First day</Label>
          <Input id='school-starts' type='date' value={year.startsOn} onChange={(e) => setYear({ ...year, startsOn: e.target.value })} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='school-ends'>Last day</Label>
          <Input id='school-ends' type='date' value={year.endsOn} onChange={(e) => setYear({ ...year, endsOn: e.target.value })} />
        </div>
      </div>
    </WriteDialog>
  );
}
