import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { billingNotices, type LicenceWarning, type SchoolBilling } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** The school admin's licence and invoice state (lms.school_billing, 0064): spec section 13. */
export const useSchoolBilling = () =>
  useQuery({ queryKey: ['school', 'billing'], queryFn: api.schoolBilling, refetchInterval: 300_000 })

/** India's day as YYYY-MM-DD, for billingNotices. */
export const indiaToday = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

/** One alert per notice: destructive for suspended and overdue, amber (as the licence banner's) for grace and due. */
export function BillingNoticeView({ billing, today }: { billing: SchoolBilling; today: string }) {
  const notices = billingNotices(billing, today)
  if (notices.length === 0) return null
  return (
    <>
      {notices.map((n) => {
        const urgent = n.kind === 'suspended' || n.kind === 'invoice-overdue'
        return (
          <Alert
            key={n.kind}
            variant={urgent ? 'destructive' : 'default'}
            className={urgent ? undefined : 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200'}
          >
            <AlertTriangle />
            <AlertTitle>{n.title}</AlertTitle>
            <AlertDescription className={urgent ? undefined : 'text-amber-800 dark:text-amber-300'}>{n.text}</AlertDescription>
          </Alert>
        )
      })}
    </>
  )
}

/** Nothing until lms.school_billing answers, and nothing when it fails. */
export function BillingNotice() {
  const b = useSchoolBilling()
  return b.data ? <BillingNoticeView billing={b.data} today={indiaToday()} /> : null
}

/** The licence warnings to show beside the billing notice: "ended" is said by the notice in grace and suspension. */
export function licenceWarningsShown(w: LicenceWarning[], state: SchoolBilling['state'] | undefined): LicenceWarning[] {
  return state === 'grace' || state === 'suspended' ? w.filter((x) => x !== 'ended') : w
}
