import { cn } from '@/lib/utils'
import { drawnFace, usePhotos } from '@/lib/photos'
import { useAuthStore } from '@/stores/auth-store'

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

/** The signed-in person's own face. */
export function MyAvatar({ className }: { className?: string }) {
  const me = useAuthStore((s) => s.me)
  const photo = usePhotos(me ? [me.userId] : []).get(me?.userId ?? '')
  if (!me) return null
  return <PersonAvatar userId={me.userId} name={me.displayName} photo={photo} className={className} />
}
