import { blastDisable } from '@/lib/blast';
import { schools } from '@/lib/client';
import { WriteDialog } from '@/components/write-dialog';

/** Mark a person as left, as the school admin's "mark as left" does (admin.school_person_disable; owner and ops). */
export function DisablePerson({
  code,
  loginId,
  kind,
  open,
  onOpenChange,
  onDone,
}: {
  code: string;
  loginId: string;
  kind: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark ${loginId} as left?`}
      blast={blastDisable(code, loginId, kind)}
      destructive
      confirmLabel='Mark as left'
      onConfirm={(w) => schools.disablePerson({ code, loginId, ...w })}
      onDone={onDone}
    />
  );
}
