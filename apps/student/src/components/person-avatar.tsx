import { cn } from '@/lib/utils'
import { drawnFace } from '@/lib/photos'

/**
 * A person's face: their photo when the school has given one, else their
 * illustrated face. `ring` is a colour for a band around it (e.g. how a
 * student is doing).
 */
export function PersonAvatar({
  userId,
  name,
  photo,
  className,
  ring,
}: {
  userId: string
  name: string
  photo?: string | null
  className?: string
  ring?: string
}) {
  return (
    <img
      src={photo ?? drawnFace(userId)}
      alt={photo ? `Photo of ${name}` : ''}
      loading='lazy'
      className={cn('size-10 shrink-0 rounded-full bg-muted object-cover', ring && 'ring-2 ring-offset-2 ring-offset-background', className)}
      style={ring ? ({ '--tw-ring-color': ring } as React.CSSProperties) : undefined}
    />
  )
}
