import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// While open, printing shows this dialog's contents and nothing else on the page.
const PRINT_ONLY_THIS = `@media print {
  body * { visibility: hidden !important; }
  #shown-once, #shown-once * { visibility: visible !important; }
  #shown-once { position: absolute; inset: 0; }
  #shown-once [data-no-print] { display: none !important; }
}`;

/**
 * A credential shown once, to the person who made it, at that moment: new
 * PINs, a staff member's temporary password. Qrie keeps no copy; "Done"
 * clears it from the screen.
 */
export function ShownOnce({
  open,
  title,
  onDone,
  printable = false,
  note = 'Shown once. Give it to the person or the school admin now; it is not kept anywhere.',
  children,
}: {
  open: boolean;
  title: string;
  onDone(): void;
  printable?: boolean;
  note?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDone()}>
      <DialogContent id='shown-once' className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        {printable && <style>{PRINT_ONLY_THIS}</style>}
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{note}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter data-no-print>
          {printable && (
            <Button variant='outline' onClick={() => window.print()}>
              Print
            </Button>
          )}
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
