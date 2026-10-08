import { blastOffboard } from '@/lib/blast';
import { schools } from '@/lib/client';
import { WriteDialog } from '@/components/write-dialog';

/** Offboard a school, or bring it back (admin.school_offboard; the owner, with a fresh code). Nothing is deleted. */
export function Offboard({
  code,
  offboard,
  open,
  onOpenChange,
  onDone,
}: {
  code: string;
  offboard: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={offboard ? `Offboard ${code}?` : `Bring ${code} back?`}
      blast={blastOffboard(code, offboard)}
      guarded
      destructive={offboard}
      confirmLabel={offboard ? 'Offboard' : 'Bring back'}
      onConfirm={(w) => schools.offboard({ code, offboard, ...w })}
      onDone={onDone}
    />
  );
}
