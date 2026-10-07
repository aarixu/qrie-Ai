import { useState } from 'react'
import { friendlyError } from '@ai-tutor/lms-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { DoorOpen, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AccountKind } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * The admin marks a student or a teacher as having left (lms.mark_left): they
 * stop seeing the school, and its teachers stop seeing them, at once. Their
 * records stay, and the list of leavers can bring them back.
 */
export function LeaveButton({
  loginId,
  name,
  kind,
  size = 'default',
  onDone,
}: {
  loginId: string
  name: string
  kind: AccountKind
  size?: 'default' | 'sm'
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const leave = useMutation({
    mutationFn: () => api.markLeft(loginId),
    onSuccess: () => {
      toast.success(`${name} is marked as left.`)
      queryClient.invalidateQueries({ queryKey: ['school'] })
      setOpen(false)
      onDone?.()
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  return (
    <>
      <Button variant='ghost' size={size} className='text-destructive hover:text-destructive' onClick={() => setOpen(true)}>
        <DoorOpen /> Left the school
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Has {name} left the school?</AlertDialogTitle>
            <AlertDialogDescription>
              {kind === 'student'
                ? `${name} will no longer be able to sign in, and their teachers will no longer see them. Their marks and reports stay, and you can undo this from the list of people who have left.`
                : `${name} will no longer be able to sign in, and their classes will be taken from them; give each class to another teacher from Classes. You can undo this from the list of people who have left.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leave.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={leave.isPending}
              onClick={(e) => {
                e.preventDefault()
                leave.mutate()
              }}
            >
              {leave.isPending ? 'Saving…' : 'Yes, they have left'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Who has left, of one kind, with a way back for each (lms.school_left, lms.restore_account). */
export function LeftList({ kinds, title }: { kinds: AccountKind[]; title: string }) {
  const queryClient = useQueryClient()
  const left = useQuery({ queryKey: ['school', 'left'], queryFn: api.schoolLeft })
  const restore = useMutation({
    mutationFn: (loginId: string) => api.restoreAccount(loginId),
    onSuccess: (_, loginId) => {
      toast.success(`${loginId} is back.`)
      queryClient.invalidateQueries({ queryKey: ['school'] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const rows = (left.data ?? []).filter((p) => kinds.includes(p.kind))
  if (rows.length === 0) return null
  return (
    <Card className='mt-8'>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>They cannot sign in and nobody sees them. Bring someone back if it was a mistake.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='divide-y'>
          {rows.map((p) => (
            <li key={p.userId} className='flex flex-wrap items-center gap-3 py-2 text-sm'>
              <span className='font-medium'>{p.displayName}</span>
              <span className='font-mono text-xs text-muted-foreground'>{p.loginId}</span>
              <span className='text-muted-foreground'>left {format(new Date(p.leftAt), 'd MMM yyyy')}</span>
              <Button
                variant='outline'
                size='sm'
                className='ms-auto'
                disabled={restore.isPending}
                onClick={() => restore.mutate(p.loginId)}
              >
                <Undo2 /> Bring back
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
