import { useEffect, useState } from 'react';
import { blastNote } from '@/lib/blast';
import { schools } from '@/lib/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { WriteDialog } from '@/components/write-dialog';

/**
 * A call or a note about the school, kept as written and never edited or
 * deleted from the console (admin.school_note_add; owner and ops). Its words
 * are not copied into the audit log.
 */
export function AddNote({ code, open, onOpenChange, onDone }: { code: string; open: boolean; onOpenChange(open: boolean): void; onDone(): void }) {
  const [kind, setKind] = useState<'call' | 'note'>('call');
  const [body, setBody] = useState('');
  useEffect(() => {
    if (open) {
      setKind('call');
      setBody('');
    }
  }, [open]);
  const length = body.trim().length;
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Add a call or a note'
      blast={blastNote(code)}
      confirmLabel='Save'
      canConfirm={length >= 1 && length <= 2000}
      onConfirm={async (w) => {
        await schools.addNote({ code, kind, body: body.trim(), ...w });
      }}
      onDone={onDone}
    >
      <div className='space-y-1'>
        <Label htmlFor='note-kind'>Kind</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as 'call' | 'note')}>
          <SelectTrigger id='note-kind' className='w-40'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='call'>A call</SelectItem>
            <SelectItem value='note'>A note</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className='space-y-1'>
        <Label htmlFor='note-body'>What was said or done ({length} of 2000)</Label>
        <Textarea id='note-body' value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={5} />
        <p className='text-xs text-muted-foreground'>Never write a child&apos;s name or words here.</p>
      </div>
    </WriteDialog>
  );
}
