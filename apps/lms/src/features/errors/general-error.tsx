import { useNavigate, useRouter } from '@tanstack/react-router'
import { CANNOT_REACH } from '@ai-tutor/lms-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
  /** What stopped the page, when the router gives it; a TypeError is a call that never reached the school. */
  error?: unknown
}

export function GeneralError({
  className,
  minimal = false,
  error,
}: GeneralErrorProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <span className='text-lg font-semibold'>This page could not load</span>
        <p className='max-w-sm text-center text-muted-foreground'>
          {error instanceof TypeError
            ? CANNOT_REACH
            : 'Try again in a moment. If it keeps happening, tell your school office what you were doing.'}
        </p>
        {!minimal && (
          <div className='mt-6 flex gap-4'>
            <Button variant='outline' onClick={() => history.go(-1)}>
              Go back
            </Button>
            <Button onClick={() => window.location.reload()}>Try again</Button>
            <Button variant='ghost' onClick={() => navigate({ to: '/' })}>
              Home
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
