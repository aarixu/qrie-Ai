import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SCHOOL_APP_DEFAULTS, type SchoolAppConfig } from '../../../packages/lms-client/src/app-config.ts'
import { AppNotices } from '../src/components/app-notices'
import { STUDENT_BUILD } from '../src/lib/build'

/**
 * WHAT A STUDENT OR PARENT SEES OF QRIE CONTROL. Written first.
 *
 * The banner as plain text, one notice for a suspended school (grace shows
 * nothing to a child or parent, R14), and an old build asked to update, with
 * the helplines.
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

function render(config: Partial<SchoolAppConfig>, children: ReactNode = <p data-testid='child'>child</p>): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  act(() =>
    root.render(
      <AppNotices config={{ ...SCHOOL_APP_DEFAULTS, ...config }} build='0.1.0'>
        {children}
      </AppNotices>
    )
  )
  return host
}
const child = (host: HTMLElement) => host.querySelector('[data-testid="child"]')

describe('the student app and Qrie control', () => {
  it("the build is package.json's version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version: string }
    expect(STUDENT_BUILD).toBe(pkg.version)
    expect(STUDENT_BUILD).toBe('0.1.0')
  })

  it('with the defaults it shows the app and nothing else', () => {
    const host = render({})
    expect(child(host)).not.toBeNull()
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('a banner, as plain text, in its tone', () => {
    const host = render({ bannerMessage: '<i>Exams</i> moved', bannerTone: 'warning' })
    const banner = host.querySelector('[role="status"][data-tone="warning"]')!
    expect(banner).not.toBeNull()
    expect(banner.textContent).toBe('<i>Exams</i> moved')
    expect(banner.querySelector('i')).toBeNull()
    expect(child(host)).not.toBeNull()
  })

  it('a suspended school shows one notice and the app; grace shows nothing', () => {
    const suspended = render({ billingState: 'suspended' })
    expect(suspended.textContent).toContain(
      "Qrie's tutor is switched off for your school for now. Your homework, marks and practice are all here as usual."
    )
    expect(child(suspended)).not.toBeNull()
    const grace = render({ billingState: 'grace', graceUntil: '2026-10-22' })
    expect(grace.textContent).toBe('child')
  })

  it('an older build is asked to update and shown nothing else but the helplines', () => {
    const old = render({ minVersion: '0.2.0' })
    expect(old.textContent).toContain('Please update the app')
    expect([...old.querySelectorAll('button')].some((b) => b.textContent === 'Reload')).toBe(true)
    expect(child(old)).toBeNull()
    // The update screen replaces Help too, so it carries the helplines itself (plan 5's merge note 8).
    const tels = [...old.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(tels).toEqual(expect.arrayContaining(['tel:14416', 'tel:1098']))
    const typo = render({ minVersion: '0.2' })
    expect(child(typo)).not.toBeNull()
  })
})
