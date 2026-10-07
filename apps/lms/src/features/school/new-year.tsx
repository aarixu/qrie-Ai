import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { ArrowRightLeft, CalendarRange } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError } from '@ai-tutor/lms-client'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

/** A label like 2027-28 for a year starting on `starts`. */
function labelFor(starts: string): string {
  const y = Number(starts.slice(0, 4))
  return Number.isFinite(y) ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : ''
}

/**
 * Starting the new school year (lms.start_new_year), in School settings: in
 * the week the session begins, every child goes up a class, Class 12 leaves,
 * and each teacher keeps their classes.
 */
export function NewYearCard() {
  const today = ymd(new Date())
  const [starts, setStarts] = useState(today)
  const [ends, setEnds] = useState(ymd(addDays(new Date(), 364)))
  const [label, setLabel] = useState(labelFor(today))
  const [confirming, setConfirming] = useState(false)
  const queryClient = useQueryClient()
  const start = useMutation({
    mutationFn: () => api.startNewYear(label, starts, ends),
    onSuccess: (r) => {
      toast.success(`${label} has begun: ${r.promoted} children moved up, ${r.graduated} finished Class 12.`)
      queryClient.invalidateQueries()
      setConfirming(false)
    },
    onError: (e) => {
      toast.error(friendlyError(e))
      setConfirming(false)
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <CalendarRange className='size-5' /> Start the new school year
        </CardTitle>
        <CardDescription>
          Do this in the first week of the new session. Every child goes up a class in the same section, Class 12
          leaves the school, and each teacher keeps the same classes for the children moving into them. Last year’s
          work and reports stay. Move a child kept back from their own page afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-wrap items-end gap-3'>
        <div className='space-y-1.5'>
          <Label htmlFor='year-starts'>Starts</Label>
          <Input
            id='year-starts'
            type='date'
            value={starts}
            onChange={(e) => {
              setStarts(e.target.value)
              setLabel(labelFor(e.target.value))
            }}
            className='w-40'
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='year-ends'>Ends</Label>
          <Input id='year-ends' type='date' value={ends} onChange={(e) => setEnds(e.target.value)} className='w-40' />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='year-label'>Name</Label>
          <Input id='year-label' value={label} onChange={(e) => setLabel(e.target.value)} className='w-28' />
        </div>
        <Button variant='outline' disabled={!label || start.isPending} onClick={() => setConfirming(true)}>
          Start {label || 'the year'}
        </Button>
      </CardContent>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start {label} now?</AlertDialogTitle>
            <AlertDialogDescription>
              Every child moves up a class at once, and Class 12 can no longer sign in. This cannot be undone in one
              step; a child can be moved back from their own page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={start.isPending}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={start.isPending}
              onClick={(e) => {
                e.preventDefault()
                start.mutate()
              }}
            >
              {start.isPending ? 'Starting…' : `Start ${label}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/** Moving one child to another section of this year (lms.move_student). */
export function MoveStudentButton({ loginId, name, roll }: { loginId: string; name: string; roll: string | null }) {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState('')
  const [newRoll, setNewRoll] = useState(roll ?? '')
  const queryClient = useQueryClient()
  const sections = useQuery({ queryKey: ['school', 'sections'], queryFn: api.schoolSections, enabled: open })
  const move = useMutation({
    mutationFn: () => api.moveStudent(loginId, section, newRoll.trim() || null),
    onSuccess: () => {
      toast.success(`${name} is moved.`)
      queryClient.invalidateQueries()
      setOpen(false)
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  return (
    <>
      <Button variant='outline' onClick={() => setOpen(true)}>
        <ArrowRightLeft /> Move
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {name}</DialogTitle>
            <DialogDescription>To another class of this year — kept back, or in the wrong section.</DialogDescription>
          </DialogHeader>
          <div className='grid gap-3 sm:grid-cols-[1fr_8rem]'>
            <div className='space-y-1.5'>
              <Label>Class</Label>
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger aria-label='Class'>
                  <SelectValue placeholder='Choose a class' />
                </SelectTrigger>
                <SelectContent>
                  {(sections.data ?? []).map((s) => (
                    <SelectItem key={s.sectionId} value={s.sectionId}>
                      Class {s.className} ({s.students} children)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='move-roll'>Roll number</Label>
              <Input id='move-roll' value={newRoll} onChange={(e) => setNewRoll(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant='ghost' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!section || move.isPending} onClick={() => move.mutate()}>
              {move.isPending ? 'Moving…' : 'Move'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
