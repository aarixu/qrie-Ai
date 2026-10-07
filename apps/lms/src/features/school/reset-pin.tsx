import { useState } from 'react'
import { friendlyError } from '@ai-tutor/lms-client'
import { useMutation } from '@tanstack/react-query'
import { Copy, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { backend } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * The admin gives one person a new PIN — for a lost slip, or a PIN somebody
 * else has seen. The old PIN stops working at once; the new one is shown
 * here, once.
 */
export function ResetPinButton({ loginId, name, size = 'default' }: { loginId: string; name: string; size?: 'default' | 'sm' }) {
  const [open, setOpen] = useState(false)
  const reset = useMutation({ mutationFn: () => backend.resetPin(loginId) })
  const close = (o: boolean) => {
    setOpen(o)
    if (!o) reset.reset()
  }
  return (
    <>
      <Button variant='outline' size={size} onClick={() => setOpen(true)}>
        <KeyRound /> New PIN
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reset.data ? `${name}'s new PIN` : `Give ${name} a new PIN?`}</DialogTitle>
            <DialogDescription>
              {reset.data
                ? 'Write it down or send it to them now. It is not shown again.'
                : `Their current PIN stops working straight away. Their ID stays ${loginId}.`}
            </DialogDescription>
          </DialogHeader>
          {reset.data && (
            <dl className='grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-lg border p-4'>
              <dt className='text-sm text-muted-foreground'>ID</dt>
              <dd className='font-mono'>{reset.data.loginId}</dd>
              <dt className='text-sm text-muted-foreground'>PIN</dt>
              <dd className='font-mono text-2xl font-bold tracking-widest'>{reset.data.pin}</dd>
            </dl>
          )}
          {reset.isError && <p className='text-sm text-destructive'>{friendlyError(reset.error)}</p>}
          <DialogFooter>
            {reset.data ? (
              <>
                <Button
                  variant='outline'
                  onClick={() =>
                    navigator.clipboard
                      .writeText(`${reset.data.loginId} ${reset.data.pin}`)
                      .then(() => toast.success('Copied.'))
                      .catch(() => toast.error('Could not copy; write it down instead.'))
                  }
                >
                  <Copy /> Copy
                </Button>
                <Button onClick={() => close(false)}>Done</Button>
              </>
            ) : (
              <>
                <Button variant='ghost' onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button disabled={reset.isPending} onClick={() => reset.mutate()}>
                  {reset.isPending ? 'Making a PIN…' : 'Give a new PIN'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
