import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SCHOOL_APP_DEFAULTS, type SchoolAppConfig, type SchoolBilling } from '@ai-tutor/lms-client'
import { AppNotices } from '@/components/app-notices'
import { BillingNoticeView, licenceWarningsShown } from '@/features/school/billing-notice'
import { LMS_BUILD } from '@/lib/build'

/**
 * WHAT A TEACHER OR THE SCHOOL ADMIN SEES OF QRIE CONTROL. Written
 * first.
 *
 * The banner as plain text and an old build asked to update, for everyone;
 * the licence and invoices due, for the school admin only (lms.school_billing,
 * 0064). Teachers see no billing state.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const roots: Root[] = []

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

function mount(node: ReactNode): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(node))
  return host
}
const notices = (config: Partial<SchoolAppConfig>) =>
  mount(
    <AppNotices config={{ ...SCHOOL_APP_DEFAULTS, ...config }} build='2.3.0'>
      <p data-testid='portal'>portal</p>
    </AppNotices>
  )
const portal = (host: HTMLElement) => host.querySelector('[data-testid="portal"]')

const OK: SchoolBilling = { state: 'ok', graceUntil: null, openInvoices: 0, duePaise: 0, earliestDueOn: null }

describe('the teacher app and Qrie control', () => {
  it("the build is package.json's version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version: string }
    expect(LMS_BUILD).toBe(pkg.version)
    expect(LMS_BUILD).toBe('2.3.0')
  })

  it('with the defaults it shows the portal and nothing else', () => {
    const host = notices({})
    expect(portal(host)).not.toBeNull()
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('a banner, as plain text, in its tone', () => {
    const host = notices({ bannerMessage: '<i>Exams</i> moved', bannerTone: 'warning' })
    const banner = host.querySelector('[role="status"][data-tone="warning"]')!
    expect(banner).not.toBeNull()
    expect(banner.textContent).toBe('<i>Exams</i> moved')
    expect(banner.querySelector('i')).toBeNull()
    expect(portal(host)).not.toBeNull()
  })

  it('an older build is asked to update and shown nothing else', () => {
    const old = notices({ minVersion: '3.0.0' })
    expect(old.textContent).toContain('This version of Qrie for teachers is too old')
    expect(old.textContent).toContain('Reload the page, or update the app, to go on.')
    expect([...old.querySelectorAll('button')].some((b) => b.textContent === 'Reload')).toBe(true)
    expect(portal(old)).toBeNull()
    expect(portal(notices({ minVersion: '3.0' }))).not.toBeNull()
    // Teachers see no billing state here, suspended or not.
    expect(notices({ billingState: 'suspended' }).textContent).toBe('portal')
  })

  it("the school admin's billing notice shows each notice billingNotices gives", () => {
    const suspended = mount(<BillingNoticeView billing={{ ...OK, state: 'suspended' }} today='2026-10-08' />)
    const alerts = [...suspended.querySelectorAll('[data-slot="alert"]')]
    expect(alerts).toHaveLength(1)
    expect(alerts[0].textContent).toContain('Your licence has ended and its grace period is over')
    expect(alerts[0].textContent).toContain(
      'The tutor is off for your school and no new people can be added. Homework, marks and exports still work. Ask Qrie to renew it.'
    )
    expect(alerts[0].className).toContain('text-destructive')

    const grace = mount(
      <BillingNoticeView
        billing={{ state: 'grace', graceUntil: '2026-10-22', openInvoices: 1, duePaise: 1180000, earliestDueOn: '2026-10-01' }}
        today='2026-10-08'
      />
    )
    const two = [...grace.querySelectorAll('[data-slot="alert"]')]
    expect(two.map((a) => a.querySelector('[data-slot="alert-title"]')?.textContent)).toEqual([
      'Your licence has ended',
      'An invoice from Qrie is overdue',
    ])
    expect(two[0].className).not.toContain('text-destructive')
    expect(two[1].className).toContain('text-destructive')

    expect(mount(<BillingNoticeView billing={OK} today='2026-10-08' />).textContent).toBe('')
  })

  it('the licence banner leaves out "has ended" when the billing notice already says so', () => {
    expect(licenceWarningsShown(['ended', 'full'], 'grace')).toEqual(['full'])
    expect(licenceWarningsShown(['ended'], 'ok')).toEqual(['ended'])
    expect(licenceWarningsShown(['ending'], 'suspended')).toEqual(['ending'])
  })
})
