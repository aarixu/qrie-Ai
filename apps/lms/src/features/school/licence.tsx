import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, BadgeCheck } from 'lucide-react'
import { billingNotices, licenceWarnings, type LicenceWarning, type SchoolLicence } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loading, Problem } from '@/components/layout/page'
import { BillingNotice, indiaToday, licenceWarningsShown, useSchoolBilling } from './billing-notice'

/** The school's licence (lms.school_licence, 0041): the admin's only. */
export const useSchoolLicence = () => useQuery({ queryKey: ['school', 'licence'], queryFn: api.schoolLicence })

const day = (ymd: string) => format(parseISO(ymd), 'd MMM yyyy')
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

function warningText(w: LicenceWarning, l: SchoolLicence): { title: string; text: string } {
  if (w === 'ended') {
    return {
      title: 'Your licence has ended',
      text: `It ended on ${day(l.validUntil!)}. Everyone can still sign in; ask Qrie to renew it.`,
    }
  }
  if (w === 'ending') {
    return {
      title: 'Your licence ends soon',
      text: `It ends on ${day(l.validUntil!)}, ${l.daysLeft === 0 ? 'today' : `in ${days(l.daysLeft!)}`}. Ask Qrie to renew it.`,
    }
  }
  return {
    title: 'Every seat is in use',
    text: `${l.seatsUsed} of ${l.seats} seats are in use, so no more students can be added from Add people. Ask Qrie for more seats.`,
  }
}

/**
 * Shown on the portal's home and on Add people while the licence has ended,
 * ends within 30 days, or has every seat in use. Nobody is locked out: it
 * only says so. With the school's billing notice (billing-notice.tsx) above
 * the licence's own warnings.
 */
export function LicenceBanner({ className }: { className?: string }) {
  const licence = useSchoolLicence()
  const billing = useSchoolBilling()
  const warnings = licence.data ? licenceWarningsShown(licenceWarnings(licence.data), billing.data?.state) : []
  const notices = billing.data ? billingNotices(billing.data, indiaToday()).length : 0
  if (warnings.length === 0 && notices === 0) return null
  return (
    <div className={cn('space-y-2', className)}>
      <BillingNotice />
      {licence.data && warnings.map((w) => {
        const { title, text } = warningText(w, licence.data)
        return (
          <Alert
            key={w}
            variant={w === 'ended' ? 'destructive' : 'default'}
            className={w === 'ended' ? undefined : 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200'}
          >
            <AlertTriangle />
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription className={w === 'ended' ? undefined : 'text-amber-800 dark:text-amber-300'}>{text}</AlertDescription>
          </Alert>
        )
      })}
    </div>
  )
}

/** The portal home's small card: the plan, its last day, and the seats in use. */
export function LicenceCard() {
  const licence = useSchoolLicence()
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <BadgeCheck className='size-5 text-primary' /> Licence
        </CardTitle>
        <CardDescription>Your school’s plan with Qrie. Each student in a class this year takes a seat.</CardDescription>
      </CardHeader>
      <CardContent>
        {licence.isPending ? (
          <Loading what='the licence' />
        ) : licence.isError ? (
          <Problem error={licence.error} />
        ) : (
          <LicenceDetails l={licence.data} />
        )}
      </CardContent>
    </Card>
  )
}

function LicenceDetails({ l }: { l: SchoolLicence }) {
  if (l.plan === null || l.seats === null || l.validUntil === null || l.daysLeft === null) {
    return (
      <div className='space-y-1'>
        <p className='font-medium'>No licence set</p>
        <p className='text-sm text-muted-foreground'>
          Qrie has not set a plan for your school yet, so nothing is limited. {l.seatsUsed}{' '}
          {l.seatsUsed === 1 ? 'student is' : 'students are'} in a class this year.
        </p>
      </div>
    )
  }
  const full = l.seatsUsed >= l.seats
  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge className='capitalize'>{l.plan}</Badge>
        <span className={cn('text-sm', l.daysLeft < 0 ? 'text-destructive' : l.daysLeft <= 30 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
          {l.daysLeft < 0
            ? `Ended on ${day(l.validUntil)}`
            : l.daysLeft === 0
              ? `Last day today, ${day(l.validUntil)}`
              : `Until ${day(l.validUntil)} · ${days(l.daysLeft)} left`}
        </span>
      </div>
      <div className='space-y-1.5'>
        <div className='flex justify-between text-sm'>
          <span>
            <span className='font-medium tabular-nums'>{l.seatsUsed}</span> of <span className='tabular-nums'>{l.seats}</span> seats in use
          </span>
          <span className={cn('tabular-nums', full ? 'text-destructive' : 'text-muted-foreground')}>
            {full ? 'None left' : `${l.seats - l.seatsUsed} left`}
          </span>
        </div>
        <div className='h-2 overflow-hidden rounded-full bg-muted'>
          <div
            className={cn('h-full rounded-full', full ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${Math.min(100, (l.seatsUsed / l.seats) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
