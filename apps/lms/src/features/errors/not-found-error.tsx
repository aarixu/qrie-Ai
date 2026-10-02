import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function NotFoundError() {
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <span className='text-lg font-semibold'>There is no page here</span>
        <p className='max-w-sm text-center text-muted-foreground'>
          The link may be old, or the work it pointed to was deleted.
        </p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            Go back
          </Button>
          <Button onClick={() => navigate({ to: '/' })}>Home</Button>
        </div>
      </div>
    </div>
  )
}
