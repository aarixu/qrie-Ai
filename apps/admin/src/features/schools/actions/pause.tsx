import { blastPause } from '@/lib/blast';
import { admin } from '@/lib/client';
import { WriteDialog } from '@/components/write-dialog';

/**
 * The tutor switch for one school: the school's own tutor.enabled value
 * (admin.flag_set, a guarded switch). `enabled` is the value being set.
 */
export function PauseTutor({
  code,
  enabled,
  open,
  onOpenChange,
  onDone,
}: {
  code: string;
  enabled: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDone(): void;
}) {
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={enabled ? `Turn the tutor back on at ${code}?` : `Pause the tutor at ${code}?`}
      blast={blastPause(code, enabled)}
      guarded
      destructive={!enabled}
      confirmLabel={enabled ? 'Turn it on' : 'Pause the tutor'}
      onConfirm={(w) => admin.flagSet({ key: 'tutor.enabled', scope: 'school', scopeId: code, value: enabled, ...w })}
      onDone={onDone}
    />
  );
}
