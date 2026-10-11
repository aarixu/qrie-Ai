import { blastFollow, blastPause } from '@/lib/blast';
import { admin } from '@/lib/client';
import type { SchoolTutorAction } from '@/lib/tutor-switch';
import { WriteDialog } from '@/components/write-dialog';

/**
 * The tutor switch for one school (a guarded switch), as lib/tutor-switch.ts
 * decides: set the school's own tutor.enabled value (admin.flag_set), or clear
 * it so the school follows the platform's switch again (admin.flag_clear,
 * 0075). `platformOn` is the platform's value, which a cleared school follows.
 */
export function PauseTutor({
  code,
  action,
  platformOn,
  open,
  onOpenChange,
  onDone,
}: {
  code: string;
  action: SchoolTutorAction;
  platformOn: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  const { write, turnsOn } = action;
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={turnsOn ? `Turn ${code}'s tutor switch back on?` : `Turn ${code}'s tutor switch off?`}
      blast={write.kind === 'clear' ? blastFollow(code, platformOn) : blastPause(code, write.value)}
      guarded
      destructive={!turnsOn}
      confirmLabel={turnsOn ? 'Turn it on' : 'Turn it off'}
      onConfirm={(w) =>
        write.kind === 'clear'
          ? admin.flagClear({ key: 'tutor.enabled', scopeId: code, ...w })
          : admin.flagSet({ key: 'tutor.enabled', scope: 'school', scopeId: code, value: write.value, ...w })
      }
      onDone={onDone}
    />
  );
}
