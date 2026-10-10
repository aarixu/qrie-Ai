import { useState } from 'react'
import { friendlyError } from '@ai-tutor/lms-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api, backend } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResetPinButton } from '@/features/school/reset-pin'

/**
 * A child's parents, on the child's page, for the admin (0045): who can see
 * this child's progress in the school's app, a sign-in for a parent who has
 * none, and the same sign-in for a brother or sister.
 */
export function ParentsCard({ studentId, loginId, name }: { studentId: string; loginId: string; name: string }) {
  const queryClient = useQueryClient()
  const parents = useQuery({ queryKey: ['parents', studentId], queryFn: () => api.studentParents(studentId) })
  const [adding, setAdding] = useState(false)
  const [linking, setLinking] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['parents', studentId] })
  const unlink = useMutation({
    mutationFn: (parentLoginId: string) => api.unlinkParent(parentLoginId, loginId),
    onSuccess: () => {
      toast.success('Unlinked. They no longer see this child.')
      refresh()
    },
    onError: (e) => toast.error(friendlyError(e)),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Users className='size-5' /> Parents
        </CardTitle>
        <CardDescription>
          A parent signs in to the school’s app with their own ID and PIN and sees {name}’s progress, attendance, report
          card and the notices for {name}’s class. They cannot change anything.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {parents.data && parents.data.length > 0 && (
          <ul className='divide-y rounded-lg border'>
            {parents.data.map((p) => (
              <li key={p.loginId} className='flex flex-wrap items-center gap-2 p-3'>
                <span className='min-w-0 flex-1'>
                  <span className='block font-medium'>{p.displayName}</span>
                  <span className='block font-mono text-xs text-muted-foreground'>{p.loginId}</span>
                </span>
                <ResetPinButton loginId={p.loginId} name={p.displayName} size='sm' />
                <Button size='sm' variant='ghost' disabled={unlink.isPending} onClick={() => unlink.mutate(p.loginId)}>
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
        )}
        {parents.data?.length === 0 && <p className='text-sm text-muted-foreground'>No parent can see {name} yet.</p>}
        <div className='flex flex-wrap gap-2'>
          <Button variant='outline' onClick={() => setAdding(true)}>
            <UserPlus /> Give a parent a sign-in
          </Button>
          <Button variant='ghost' onClick={() => setLinking(true)}>
            <Link2 /> Link a parent who has one
          </Button>
        </div>
      </CardContent>
      {adding && <AddParentDialog loginId={loginId} name={name} onClose={() => { setAdding(false); refresh() }} />}
      {linking && <LinkParentDialog loginId={loginId} name={name} onClose={() => { setLinking(false); refresh() }} />}
    </Card>
  )
}

function AddParentDialog({ loginId, name, onClose }: { loginId: string; name: string; onClose: () => void }) {
  const [parentName, setParentName] = useState('')
  const add = useMutation({ mutationFn: () => backend.addParent({ studentLoginId: loginId, displayName: parentName }) })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{add.data ? `${add.data.displayName}'s sign-in` : `A sign-in for ${name}'s parent`}</DialogTitle>
          <DialogDescription>
            {add.data
              ? 'Write it down or send it to them now. The PIN is not shown again.'
              : 'They sign in to the school’s app — the one the children use — and see only their own children.'}
          </DialogDescription>
        </DialogHeader>
        {add.data ? (
          <dl className='grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 rounded-lg border p-4'>
            <dt className='text-sm text-muted-foreground'>ID</dt>
            <dd className='font-mono'>{add.data.loginId}</dd>
            <dt className='text-sm text-muted-foreground'>PIN</dt>
            <dd className='font-mono text-2xl font-bold tracking-widest'>{add.data.pin}</dd>
          </dl>
        ) : (
          <div className='space-y-1.5'>
            <Label htmlFor='parent-name'>Parent’s name</Label>
            <Input id='parent-name' value={parentName} maxLength={80} onChange={(e) => setParentName(e.target.value)} />
          </div>
        )}
        {add.isError && <p className='text-sm text-destructive'>{friendlyError(add.error)}</p>}
        <DialogFooter>
          {add.data ? (
            <>
              <Button
                variant='outline'
                onClick={() =>
                  navigator.clipboard
                    .writeText(`${add.data.loginId} ${add.data.pin}`)
                    .then(() => toast.success('Copied.'))
                    .catch(() => toast.error('Could not copy; write it down instead.'))
                }
              >
                <Copy /> Copy
              </Button>
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              <Button variant='ghost' onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!parentName.trim() || add.isPending} onClick={() => add.mutate()}>
                {add.isPending ? 'Making a sign-in…' : 'Make the sign-in'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LinkParentDialog({ loginId, name, onClose }: { loginId: string; name: string; onClose: () => void }) {
  const [parentId, setParentId] = useState('')
  const link = useMutation({
    mutationFn: () => api.linkParent(parentId.trim().toUpperCase(), loginId),
    onSuccess: () => {
      toast.success(`Linked. They now see ${name} too.`)
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link a parent to {name}</DialogTitle>
          <DialogDescription>
            For a brother or sister: the parent keeps their ID and PIN, and sees {name} beside their other children.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-1.5'>
          <Label htmlFor='parent-id'>The parent’s ID</Label>
          <Input
            id='parent-id'
            value={parentId}
            // The demo school's IDs are the example only in a build for the demo school.
            placeholder={backend.mode === 'demo' ? 'DEMO-P1' : undefined}
            onChange={(e) => setParentId(e.target.value)}
          />
        </div>
        {link.isError && <p className='text-sm text-destructive'>{friendlyError(link.error)}</p>}
        <DialogFooter>
          <Button variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!parentId.trim() || link.isPending} onClick={() => link.mutate()}>
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
