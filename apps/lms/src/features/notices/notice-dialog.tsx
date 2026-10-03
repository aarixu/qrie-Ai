import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { friendlyError, type NoticeAttachmentMime } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'
import { Loading, Problem } from '@/components/layout/page'

const TITLE_MAX = 120
const BODY_MAX = 2000
const FILE_TYPES: NoticeAttachmentMime[] = ['application/pdf', 'image/jpeg', 'image/png']
const FILE_MAX = 512 * 1024

/** A file's bytes as base64, without the data-URL prefix. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error('Could not read that file.'))
    r.readAsDataURL(file)
  })
}

/** The sections the caller may send to: the classes they teach, or for the admin every class of this year. */
function useTargets(isAdmin: boolean) {
  const taught = useQuery({ queryKey: ['classes'], queryFn: api.myClasses, enabled: !isAdmin })
  const sections = useQuery({ queryKey: ['school', 'sections'], queryFn: api.schoolSections, enabled: isAdmin })
  const q = isAdmin ? sections : taught
  const list = isAdmin
    ? (sections.data ?? []).map((s) => ({ sectionId: s.sectionId, label: s.className }))
    : [...new Map((taught.data ?? []).map((c) => [c.sectionId, `${c.grade}${c.sectionName}`])).entries()].map(
        ([sectionId, label]) => ({ sectionId, label })
      )
  return { list, isPending: q.isPending, error: q.error }
}

/**
 * A new notice (lms.send_notice): to one or more classes the teacher teaches,
 * or — the admin only — the whole school, with at most one PDF, JPEG or PNG of
 * 512 KB. The server checks all of it again.
 */
export function NoticeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const isAdmin = useAuthStore((s) => s.me?.kind) === 'admin'
  const targets = useTargets(isAdmin)
  const queryClient = useQueryClient()
  const [wholeSchool, setWholeSchool] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const problem = !title.trim()
    ? 'Give the notice a title.'
    : !body.trim()
      ? 'Write the message.'
      : !wholeSchool && picked.length === 0
        ? 'Choose who it is for.'
        : null

  const send = useMutation({
    mutationFn: async () =>
      api.sendNotice({
        title: title.trim(),
        body: body.trim(),
        sectionIds: wholeSchool ? null : picked,
        attachment: file ? { name: file.name, mime: file.type as NoticeAttachmentMime, base64: await base64Of(file) } : undefined,
      }),
    onSuccess: () => {
      toast.success('Notice sent. Everyone it is for sees it in their app.')
      queryClient.invalidateQueries({ queryKey: ['notices'] })
      setTitle('')
      setBody('')
      setFile(null)
      setPicked([])
      setWholeSchool(false)
      onOpenChange(false)
    },
    onError: (e) => toast.error(friendlyError(e)),
  })

  const choose = (f: File | undefined) => {
    if (!f) return
    if (!(FILE_TYPES as string[]).includes(f.type)) return toast.error('Attach a PDF, a JPEG or a PNG.')
    if (f.size > FILE_MAX) return toast.error('An attachment must be 512 KB or smaller.')
    setFile(f)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>New notice</DialogTitle>
          <DialogDescription>
            It appears in the app of every child it is for{isAdmin ? ', and of every teacher when it is for the whole school' : ''}.
            You will see who has read it.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <fieldset className='space-y-2'>
            <legend className='mb-1.5 text-sm font-medium'>For</legend>
            {isAdmin && (
              <label className='flex items-center gap-2 text-sm'>
                <Checkbox checked={wholeSchool} onCheckedChange={(v) => setWholeSchool(v === true)} />
                The whole school: every child and every teacher
              </label>
            )}
            {!wholeSchool &&
              (targets.isPending ? (
                <Loading what='your classes' />
              ) : targets.error ? (
                <Problem error={targets.error} />
              ) : targets.list.length === 0 ? (
                <p className='text-sm text-muted-foreground'>You have no classes this year.</p>
              ) : (
                <div className='flex flex-wrap gap-x-4 gap-y-2'>
                  {targets.list.map((t) => (
                    <label key={t.sectionId} className='flex items-center gap-2 text-sm'>
                      <Checkbox
                        checked={picked.includes(t.sectionId)}
                        onCheckedChange={(v) =>
                          setPicked((p) => (v === true ? [...p, t.sectionId] : p.filter((x) => x !== t.sectionId)))
                        }
                      />
                      Class {t.label}
                    </label>
                  ))}
                </div>
              ))}
          </fieldset>
          <div className='space-y-1.5'>
            <Label htmlFor='notice-title'>Title</Label>
            <Input
              id='notice-title'
              maxLength={TITLE_MAX}
              placeholder='Bring your geometry box tomorrow'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='notice-body'>Message</Label>
            <Textarea id='notice-body' rows={6} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} />
            <p className='text-end text-xs text-muted-foreground tabular-nums'>
              {body.length} / {BODY_MAX}
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {file ? (
              <span className='inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-sm'>
                <Paperclip className='size-4 shrink-0' />
                <span className='truncate'>{file.name}</span>
                <span className='text-muted-foreground tabular-nums'>· {Math.max(1, Math.round(file.size / 1024))} KB</span>
                <Button variant='ghost' size='icon' className='size-6' aria-label='Remove the attachment' onClick={() => setFile(null)}>
                  <X />
                </Button>
              </span>
            ) : (
              <Button asChild variant='outline' size='sm'>
                <label className='cursor-pointer'>
                  <Paperclip /> Attach a file
                  <input
                    type='file'
                    accept='application/pdf,image/jpeg,image/png'
                    className='sr-only'
                    onChange={(e) => {
                      choose(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
              </Button>
            )}
            <span className='text-xs text-muted-foreground'>One PDF, JPEG or PNG, 512 KB at most.</span>
          </div>
        </div>
        <DialogFooter className='items-center gap-2'>
          {problem && <p className='me-auto text-sm text-muted-foreground'>{problem}</p>}
          <Button disabled={!!problem || send.isPending} onClick={() => send.mutate()}>
            <Send /> {send.isPending ? 'Sending…' : 'Send notice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
