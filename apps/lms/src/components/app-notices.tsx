import type { ReactNode } from 'react'
import { isBelowMinimum, type SchoolAppConfig } from '@ai-tutor/lms-client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * What Qrie control says, in front of the teacher app: an older
 * build than app.min_version.lms is asked to update and shown nothing else;
 * otherwise the banner as plain text, then the app. Teachers see no billing
 * state here; the school admin's licence and invoices are on the portal
 * (features/school/billing-notice.tsx). Pure: the config comes from
 * lib/app-config.tsx.
 */
export function AppNotices({ config, build, children }: { config: SchoolAppConfig; build: string; children: ReactNode }) {
  if (isBelowMinimum(build, config.minVersion)) {
    return (
      <div className='mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 p-6 text-center'>
        <h1 className='text-xl font-semibold'>This version of Qrie for teachers is too old</h1>
        <p className='text-sm text-muted-foreground'>Reload the page, or update the app, to go on.</p>
        <Button type='button' onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    )
  }
  return (
    <>
      {config.bannerMessage !== '' && (
        <Alert
          role='status'
          data-tone={config.bannerTone}
          className={
            config.bannerTone === 'warning'
              ? 'rounded-none border-x-0 border-t-0 border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200'
              : 'rounded-none border-x-0 border-t-0'
          }
        >
          <AlertDescription className={config.bannerTone === 'warning' ? 'text-amber-800 dark:text-amber-300' : undefined}>
            {config.bannerMessage}
          </AlertDescription>
        </Alert>
      )}
      {children}
    </>
  )
}
