import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { signOut, useAuthStore } from '@/stores/auth-store'
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

/** The phone frame every signed-in screen sits in: the school's name, and a way out. */
export function Shell() {
  const me = useAuthStore((s) => s.me)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [leaving, setLeaving] = useState(false)

  return (
    <div className='mx-auto flex min-h-svh max-w-md flex-col bg-background'>
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
      <main className='flex-1 px-4 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]'>
        <Outlet />
      </main>
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
