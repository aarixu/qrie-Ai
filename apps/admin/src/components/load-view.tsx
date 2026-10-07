import type { ReactNode } from 'react';
import type { Loaded } from '@/lib/load-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * One read's four states on screen (lib/load-state.ts): skeletons while
 * loading; "Your role cannot see this." with no retry when refused; the
 * message and "Try again" on an error; the data when ready, with a failed
 * reload's message above the last good data.
 */
export function LoadView<T>({
  view,
  reload,
  skeletons = 3,
  children,
}: {
  view: Loaded<T>;
  reload(): void;
  skeletons?: number;
  children(data: T): ReactNode;
}) {
  if (view.state === 'loading') {
    return (
      <div className='space-y-3'>
        {Array.from({ length: skeletons }, (_, i) => (
          <Skeleton key={i} className='h-14' />
        ))}
      </div>
    );
  }
  if (view.state === 'refused') return <p className='text-sm text-muted-foreground'>Your role cannot see this.</p>;
  if (view.state === 'error') return <Failure message={view.message} reload={reload} />;
  return (
    <>
      {view.error && <Failure message={`Could not refresh: ${view.error}`} reload={reload} className='mb-4' />}
      {children(view.data)}
    </>
  );
}

function Failure({ message, reload, className }: { message: string; reload(): void; className?: string }) {
  return (
    <Alert variant='destructive' className={className}>
      <AlertDescription className='flex flex-wrap items-center gap-3'>
        <span>{message}</span>
        <Button size='sm' variant='outline' onClick={reload}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
