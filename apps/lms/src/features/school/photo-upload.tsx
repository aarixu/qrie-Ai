import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, CheckCircle2, ImagePlus, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/backend'
import { photoForUpload } from '@/lib/photos'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Pick = { file: File; loginId: string; name: string | null; state: 'waiting' | 'done' | 'failed'; error?: string }

/** The file's name as a school ID: 'demo-8a-1.jpg' and 'DEMO-8A-1 (1).JPG' both read as DEMO-8A-1. */
export function idFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/\s*\(\d+\)$/, '')
    .trim()
    .toUpperCase()
}

/**
 * Many photos at once: each file named by the person's school ID
 * (DEMO-8A-1.jpg), matched to the people in the school, shrunk in the
 * browser to a small square JPEG and sent one by one (lms.set_account_photo).
 */
export function PhotoUploadButton() {
  const [open, setOpen] = useState(false)
  const [picks, setPicks] = useState<Pick[]>([])
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const people = useQuery({
    queryKey: ['school', 'people-by-id'],
    enabled: open,
    queryFn: async () => {
      const [students, teachers] = await Promise.all([api.schoolStudents(), api.schoolTeachers()])
      return new Map([...students, ...teachers].map((p) => [p.loginId, p.displayName]))
    },
  })

  const choose = (files: FileList | null) => {
    const map = people.data ?? new Map<string, string>()
    setPicks(
      [...(files ?? [])].map((file) => {
        const loginId = idFromFileName(file.name)
        return { file, loginId, name: map.get(loginId) ?? null, state: 'waiting' }
      })
    )
  }

  const upload = async () => {
    setBusy(true)
    let done = 0
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i]!
      if (!p.name || p.state === 'done') continue
      try {
        await api.setAccountPhoto(p.loginId, await photoForUpload(p.file))
        done += 1
        setPicks((ps) => ps.map((x, j) => (j === i ? { ...x, state: 'done' } : x)))
      } catch (e) {
        setPicks((ps) => ps.map((x, j) => (j === i ? { ...x, state: 'failed', error: (e as Error).message } : x)))
      }
    }
    setBusy(false)
    queryClient.invalidateQueries({ queryKey: ['photos'] })
    if (done) toast.success(`${done} ${done === 1 ? 'photo' : 'photos'} saved.`)
  }

  const matched = picks.filter((p) => p.name && p.state !== 'done').length

  return (
    <>
      <Button variant='outline' onClick={() => setOpen(true)}>
        <Camera /> Upload photos
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return
          setOpen(o)
          if (!o) setPicks([])
        }}
      >
        <DialogContent className='sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>Upload photos</DialogTitle>
            <DialogDescription>
              Name each picture by the person's school ID, like DEMO-8A-1.jpg, and choose them all at once. Each is cut
              to a square from its middle. Upload only photos your school may use, with parents' consent for children.
            </DialogDescription>
          </DialogHeader>
          <label className='flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 hover:bg-accent/50'>
            <ImagePlus className='size-6 text-primary' />
            <span className='text-sm'>
              <span className='block font-medium'>Choose photos</span>
              <span className='text-muted-foreground'>JPEG, PNG or WebP · any size</span>
            </span>
            <input
              type='file'
              accept='image/*'
              multiple
              className='sr-only'
              disabled={busy || people.isPending}
              onChange={(e) => {
                choose(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          {people.isError && <p className='text-sm text-destructive'>{(people.error as Error).message}</p>}
          {picks.length > 0 && (
            <ul className='max-h-72 divide-y overflow-auto rounded-md border text-sm'>
              {picks.map((p) => (
                <li key={`${p.file.name}-${p.file.size}`} className='flex items-center gap-2 px-3 py-2'>
                  {p.state === 'done' ? (
                    <CheckCircle2 className='size-4 shrink-0 text-green-600' />
                  ) : !p.name || p.state === 'failed' ? (
                    <XCircle className='size-4 shrink-0 text-destructive' />
                  ) : (
                    <span className='size-4 shrink-0 rounded-full border' />
                  )}
                  <span className='min-w-0 flex-1 truncate font-mono text-xs'>{p.file.name}</span>
                  <span className={p.name ? 'truncate' : 'text-destructive'}>
                    {p.error ?? p.name ?? `No one has the ID ${p.loginId}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant='ghost' disabled={busy} onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button disabled={busy || matched === 0} onClick={upload}>
              {busy ? 'Saving…' : `Save ${matched} ${matched === 1 ? 'photo' : 'photos'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
