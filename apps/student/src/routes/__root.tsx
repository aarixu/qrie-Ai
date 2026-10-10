import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet, useRouter } from '@tanstack/react-router'
import { say } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'

/**
 * A page that could not load: why, in the school's own words or one plain
 * sentence ("Could not reach your school…" when there is no signal), and a
 * way to try again, which loads the page afresh.
 */
function PageError({ error }: { error: unknown }) {
  const router = useRouter()
  return (
    <div className='mx-auto max-w-md p-6 text-center'>
      <p className='mb-2 font-medium'>This page could not load.</p>
      <p className='mb-4 text-sm text-muted-foreground'>{say(error)}</p>
      <div className='flex items-center justify-center gap-4'>
        <Button onClick={() => void router.invalidate()}>Try again</Button>
        <Link to='/' className='underline'>
          Go to your homework
        </Link>
      </div>
    </div>
  )
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <Outlet />
      <Toaster duration={4000} />
    </>
  ),
  notFoundComponent: () => (
    <div className='mx-auto max-w-md p-6 text-center'>
      <p className='mb-4'>That page does not exist.</p>
      <Link to='/' className='underline'>
        Go to your homework
      </Link>
    </div>
  ),
  errorComponent: PageError,
})
