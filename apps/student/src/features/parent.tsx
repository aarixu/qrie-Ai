import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { MyChild } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { usePhoto } from '@/lib/photos'
import { useAuthStore } from '@/stores/auth-store'
import { PersonAvatar } from '@/components/person-avatar'
import { NoticesOnHome } from './notices'
import { ProgressPage } from './progress'

const useChildren = () => useQuery({ queryKey: ['my-children'], queryFn: api.myChildren })

function ChildCard({ c }: { c: MyChild }) {
  const photo = usePhoto(c.userId)
  return (
    <Link
      to='/child/$studentId'
      params={{ studentId: c.userId }}
      className='flex items-center gap-3 rounded-2xl border bg-card p-3 transition-colors hover:bg-muted'
    >
      <PersonAvatar userId={c.userId} name={c.displayName} photo={photo} className='size-12' />
      <span className='min-w-0 flex-1'>
        <span className='block truncate font-semibold'>{c.displayName}</span>
        <span className='block text-sm text-muted-foreground'>
          {c.className ? `Class ${c.className}${c.rollNumber ? ` · Roll ${c.rollNumber}` : ''}` : 'In no class this year'}
        </span>
      </span>
      <ChevronRight className='size-5 text-muted-foreground' />
    </Link>
  )
}

/**
 * A parent's home: their children, each opening to the child's progress, and
 * the notices for their children's classes and the whole school (0045).
 */
export function ParentHome() {
  const me = useAuthStore((s) => s.me)
  const children = useChildren()
  return (
    <div className='space-y-6'>
      <div>
        <p className='text-sm text-muted-foreground'>Hello,</p>
        <h1 className='text-2xl font-bold'>{me?.displayName}</h1>
      </div>
      <section>
        <h2 className='mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>Your children</h2>
        {children.isPending ? (
          <p className='text-muted-foreground'>Loading…</p>
        ) : children.isError ? (
          <p className='text-destructive'>{say(children.error)}</p>
        ) : children.data.length === 0 ? (
          <p className='rounded-xl bg-muted p-3 text-sm text-muted-foreground'>
            No child is linked to your sign-in yet. Ask the school office to link your child.
          </p>
        ) : (
          <ul className='space-y-2'>
            {children.data.map((c) => (
              <li key={c.userId}>
                <ChildCard c={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <NoticesOnHome />
    </div>
  )
}

/** One of a parent's children: their progress and report card, read-only. */
export function ChildPage({ studentId }: { studentId: string }) {
  const children = useChildren()
  const child = children.data?.find((c) => c.userId === studentId)
  return (
    <div className='space-y-4'>
      <Link to='/' className='inline-flex items-center gap-1 text-sm font-medium text-primary'>
        <ChevronLeft className='size-4' /> Your children
      </Link>
      {children.isPending ? (
        <p className='text-muted-foreground'>Loading…</p>
      ) : children.isError ? (
        <p className='text-destructive'>{say(children.error)}</p>
      ) : !child ? (
        <p className='text-muted-foreground'>This child is not linked to your sign-in.</p>
      ) : (
        <ProgressPage child={{ userId: child.userId, displayName: child.displayName }} />
      )}
    </div>
  )
}
