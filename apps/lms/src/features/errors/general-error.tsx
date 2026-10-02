import { useNavigate, useRouter } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
}

export function GeneralError({
  className,
  minimal = false,
}: GeneralErrorProps) {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <span className='text-lg font-semibold'>This page could not load</span>
        <p className='max-w-sm text-center text-muted-foreground'>
          Try again in a moment. If it keeps happening, tell your school office what you were doing.
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
