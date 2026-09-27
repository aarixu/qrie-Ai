import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { BarChart3, ClipboardList, House, LogOut, Sparkles } from 'lucide-react'
import { signOut, useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
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

const TABS = [
  { to: '/', label: 'Home', icon: House },
  { to: '/work', label: 'Work', icon: ClipboardList },
  { to: '/learn', label: 'Learn', icon: Sparkles },
  { to: '/progress', label: 'Progress', icon: BarChart3 },
] as const

/**
 * The phone frame every signed-in screen sits in: the school's name, a way
 * out, and the four tabs. The tabs step aside while a child is inside one
 * piece of work or a practice round, so a stray tap does not leave it.
 */
export function Shell() {
  const me = useAuthStore((s) => s.me)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [leaving, setLeaving] = useState(false)
  const path = useRouterState({ select: (s) => s.location.pathname })
  const focused = path.startsWith('/homework/') || path.startsWith('/learn/practice')

  return (
    <div className='mx-auto flex min-h-svh max-w-md flex-col bg-background'>
      {!focused && (
        <header className='sticky top-0 z-10 flex items-center gap-3 bg-primary px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 text-primary-foreground'>
          <Link to='/' className='min-w-0 flex-1'>
            <p className='truncate text-sm opacity-80'>{me?.schoolName}</p>
            <p className='truncate font-semibold'>{me?.displayName}</p>
          </Link>
          <Button
            variant='ghost'
            size='icon'
            className='text-primary-foreground hover:bg-white/10 hover:text-primary-foreground'
            aria-label='Sign out'
            onClick={() => setLeaving(true)}
          >
            <LogOut />
          </Button>
        </header>
      )}
      <main className={cn('flex-1 px-4 py-4', focused ? 'pb-[max(env(safe-area-inset-bottom),1rem)]' : 'pb-24')}>
        <Outlet />
      </main>
      {!focused && (
        <nav
          aria-label='Sections'
          className='fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur'
        >
          {TABS.map((t) => {
            const active = t.to === '/' ? path === '/' : path.startsWith(t.to)
            return (
              <Link
                key={t.to}
                to={t.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition-colors',
                  active ? 'font-semibold text-primary' : 'text-muted-foreground'
                )}
              >
                <span className={cn('rounded-full px-4 py-1 transition-colors', active && 'bg-primary/10')}>
                  <t.icon className='size-5' />
                </span>
                {t.label}
              </Link>
            )
          })}
        </nav>
      )}
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will need your ID and PIN to sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await signOut()
                queryClient.clear()
                navigate({ to: '/sign-in', replace: true })
              }}
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
