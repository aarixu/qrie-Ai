import type { ReactNode } from 'react'
import { isBelowMinimum, type SchoolAppConfig } from '@ai-tutor/lms-client'
import { HELPLINE_LINES } from '../lib/report'

/**
 * What Qrie control says, in front of the student app: an older
 * build than app.min_version.student is asked to update and shown nothing
 * else but the helplines (the screen replaces Help, plan 5); otherwise the banner as plain text, then, for a suspended school, one
 * notice that the tutor is off and the rest is as usual; then the app. A
 * school in grace shows a child or parent nothing (R14). Pure: the config
 * comes from lib/app-config.tsx.
 */
export function AppNotices({ config, build, children }: { config: SchoolAppConfig; build: string; children: ReactNode }) {
  if (isBelowMinimum(build, config.minVersion)) {
    return (
      <div className='mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center'>
        <h1 className='text-xl font-semibold'>Please update the app</h1>
        <p className='text-sm text-muted-foreground'>
          This copy of the app is too old to use. On a phone, update it from where you installed it; in a browser,
          reload the page.
        </p>
        <button
          type='button'
          onClick={() => window.location.reload()}
          className='mt-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground'
        >
          Reload
        </button>
        <ul className='mt-4 space-y-1 text-sm'>
          {HELPLINE_LINES.map((h) => (
            <li key={h.number}>
              <a href={`tel:${h.number}`} className='underline'>
                {h.name} {h.number}
              </a>{' '}
              <span className='text-muted-foreground'>{h.what}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <>
      {config.bannerMessage !== '' && (
        <div
          role='status'
          data-tone={config.bannerTone}
          className={
            config.bannerTone === 'warning'
              ? 'border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900'
              : 'border-b bg-muted px-4 py-2 text-center text-sm'
          }
        >
          {config.bannerMessage}
        </div>
      )}
      {config.billingState === 'suspended' && (
        <div className='border-b bg-muted px-4 py-2 text-center text-sm'>
          Qrie's tutor is switched off for your school for now. Your homework, marks and practice are all here as usual.
        </div>
      )}
      {children}
    </>
  )
}
