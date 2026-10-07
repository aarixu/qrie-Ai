import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { isOffline, newKey, workPath, type MyAssignment } from '@ai-tutor/lms-client'
import { api, backend, say } from '@/lib/backend'
import { useOutbox } from '@/lib/outbox'
import { shrinkPhoto } from '@/lib/photo'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'

const MAX = 10

type Page = { blob: Blob; url: string }

/** Photos of notebook pages: taken or chosen, shrunk on the phone, then handed in together. */
export function Photos({ a }: { a: MyAssignment }) {
  const me = useAuthStore((s) => s.me)!
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [preparing, setPreparing] = useState(false)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { box } = useOutbox()

  // Previews are freed when removed, and the rest when the screen closes.
  const made = useRef<string[]>([])
  useEffect(() => () => made.current.forEach((u) => URL.revokeObjectURL(u)), [])

  async function add(files: FileList | null) {
    if (!files?.length) return
    setPreparing(true)
    setProblem(null)
    const next: Page[] = []
    try {
      for (const f of Array.from(files).slice(0, MAX - pages.length)) {
        const blob = await shrinkPhoto(f)
        const url = URL.createObjectURL(blob)
        made.current.push(url)
        next.push({ blob, url })
      }
    } catch (e) {
      setProblem(say(e))
    } finally {
      setPages((p) => [...p, ...next])
      setPreparing(false)
      if (input.current) input.current.value = ''
    }
  }

  async function handIn() {
    setSending(true)
    setProblem(null)
    const stamp = Date.now()
    const names = pages.map((_, i) => workPath(me.orgId, a.id, me.userId, `page-${i + 1}-${stamp}.jpg`))
    const blobs = pages.map((p) => new Blob([p.blob], { type: 'image/jpeg' }))
    // The key this hand-in is sent under, so sending it again is the same hand-in (0044).
    const key = newKey()
    let uploaded = 0
    try {
      for (const [i, blob] of blobs.entries()) {
        await backend.uploadWork(names[i], blob)
        uploaded = i + 1
      }
      await api.submitPhotos(a.id, names, key)
      await queryClient.invalidateQueries({ queryKey: ['my-assignments'] })
      toast.success('Photos handed in!')
    } catch (e) {
      if (isOffline(e) && box) {
        // No internet: the photos wait on the phone and go by themselves when
        // it is back (components/outbox-banner.tsx), from the page they got to.
        await box.add({ kind: 'photos', assignmentId: a.id, title: a.title, key, names, pages: blobs, uploaded })
        pages.forEach((p) => URL.revokeObjectURL(p.url))
        setPages([])
        toast.info('No internet. Your photos are kept on this phone and will be handed in when it is back.')
      } else {
        setProblem(say(e))
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className='space-y-3'>
      <input
        ref={input}
        type='file'
        accept='image/*'
        capture='environment'
        multiple
        className='hidden'
        onChange={(e) => void add(e.target.files)}
      />
      {pages.length > 0 && (
        <div className='grid grid-cols-3 gap-2'>
          {pages.map((p, i) => (
            <div key={p.url} className='relative'>
              <img src={p.url} alt={`Page ${i + 1}`} className='aspect-[3/4] w-full rounded-lg border object-cover' />
              <button
                type='button'
                aria-label={`Remove page ${i + 1}`}
                className='absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white'
                onClick={() => {
                  URL.revokeObjectURL(p.url)
                  setPages(pages.filter((x) => x !== p))
                }}
              >
                <X className='size-4' />
              </button>
            </div>
          ))}
        </div>
      )}
      <Button
        variant='outline'
        className='h-12 w-full'
        disabled={preparing || sending || pages.length >= MAX}
        onClick={() => input.current?.click()}
      >
        {preparing ? <Loader2 className='animate-spin' /> : <Camera />}
        {pages.length === 0 ? 'Take or choose a photo' : 'Add another page'}
      </Button>
      {problem && <p className='text-sm text-destructive'>{problem}</p>}
      {pages.length > 0 && (
        <Button className='h-12 w-full text-base' disabled={sending || preparing} onClick={() => void handIn()}>
          {sending && <Loader2 className='animate-spin' />}
          Hand in {pages.length} {pages.length === 1 ? 'photo' : 'photos'}
        </Button>
      )}
    </div>
  )
}
