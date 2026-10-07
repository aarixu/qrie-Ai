import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'

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
  errorComponent: ({ error }) => (
    <div className='mx-auto max-w-md p-6 text-center'>
      <p className='mb-2 font-medium'>Something went wrong.</p>
      <p className='mb-4 text-sm text-muted-foreground'>{(error as Error).message}</p>
      <Link to='/' className='underline'>
        Go to your homework
      </Link>
    </div>
  ),
})
