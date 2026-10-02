import { useRef } from 'react'
import { friendlyError } from '@ai-tutor/lms-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { StudentCard } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { hueFor } from '@/lib/palette'
import { photoForUpload, usePhotos } from '@/lib/photos'
import { Button } from '@/components/ui/button'
import { PersonAvatar } from '@/components/person-avatar'

/**
 * The top of a student's report: their face, name, class and school, on a
 * band of their class's colour. The admin may change or remove the photo
 * here (lms.set_account_photo); anybody else only sees it.
 */
export function ProfileHeader({
  card,
  ring,
  canEditPhoto,
  note,
}: {
  card: StudentCard
  ring: string
  canEditPhoto: boolean
  note?: string
}) {
  const photo = usePhotos([card.userId]).get(card.userId)
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const save = useMutation({
    mutationFn: async (file: File | null) =>
      api.setAccountPhoto(card.loginId, file ? await photoForUpload(file) : null),
    onSuccess: (_, file) => {
      toast.success(file ? 'Photo saved.' : 'Photo removed.')
      queryClient.invalidateQueries({ queryKey: ['photos'] })
    },
    onError: (e) => toast.error(friendlyError(e)),
  })
  const hue = hueFor(card.className ?? card.displayName)

  return (
    <section className='overflow-hidden rounded-2xl border bg-card'>
      <div className='h-20' style={{ background: `linear-gradient(120deg, ${hue.solid}40, ${hue.solid}0d)` }} />
      <div className='-mt-12 flex flex-wrap items-end gap-4 px-5 pb-5'>
        <div className='relative'>
          <PersonAvatar
            userId={card.userId}
            name={card.displayName}
            photo={photo}
            ring={ring}
            className='size-24 border-4 border-card'
          />
          {canEditPhoto && (
            <button
              type='button'
              aria-label={photo ? 'Change photo' : 'Add a photo'}
              title={photo ? 'Change photo' : 'Add a photo'}
              disabled={save.isPending}
              onClick={() => input.current?.click()}
              className='absolute right-0 bottom-0 grid size-8 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow'
            >
              <Camera className='size-4' />
            </button>
          )}
          <input
            ref={input}
            type='file'
            accept='image/*'
            className='sr-only'
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) save.mutate(file)
            }}
          />
        </div>
        <div className='min-w-0 flex-1 pb-1'>
          <p className='text-xl font-bold'>{card.displayName}</p>
          <p className='text-sm text-muted-foreground'>
            {card.schoolName} · Class {card.className ?? '—'} · Roll {card.rollNumber ?? '—'} ·{' '}
            <span className='font-mono'>{card.loginId}</span>
          </p>
          {note && <p className='text-xs text-muted-foreground'>{note}</p>}
        </div>
        {canEditPhoto && photo && (
          <Button variant='ghost' size='sm' disabled={save.isPending} onClick={() => save.mutate(null)}>
            <Trash2 /> Remove photo
          </Button>
        )}
      </div>
    </section>
  )
}
