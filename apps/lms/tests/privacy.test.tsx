import fs from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * THE PRIVACY NOTICE IN THE TEACHER APP AND SCHOOL PORTAL, at /privacy.
 * Written first.
 *
 * Reached without signing in, from the sign-in screen, and when signed in
 * from the sidebar's Help group (teacher and admin alike). The contact is the
 * address the app was built with (VITE_QRIE_PRIVACY_CONTACT); without one, the
 * notice sends people to the school office. The text itself is
 * packages/lms-client's (tests/privacy.test.ts); here, what this app tells
 * it about its own build.
 */

const PROJECT = 'https://abcdefghijklmnopqrst.supabase.co'

const roots: Root[] = []
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The router restores scroll on each page; jsdom has no scrolling.
  window.scrollTo = () => undefined
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  vi.unstubAllEnvs()
})

// Set both ways on purpose: this laptop's .env.local sets the hosted pair for the tutor.
function demoBuild(contact = '') {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  vi.stubEnv('VITE_QRIE_RELAY_URL', '')
  vi.stubEnv('VITE_QRIE_PRIVACY_CONTACT', contact)
  vi.stubEnv('VITE_QRIE_WEB_HOST', '')
  vi.stubEnv('VITE_QRIE_BACKUP_HOST', '')
}
function hostedBuild(relay: string, hosts: { web?: string; backup?: string } = {}) {
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests')
  vi.stubEnv('VITE_QRIE_RELAY_URL', relay)
  vi.stubEnv('VITE_QRIE_PRIVACY_CONTACT', '')
  vi.stubEnv('VITE_QRIE_WEB_HOST', hosts.web ?? '')
  vi.stubEnv('VITE_QRIE_BACKUP_HOST', hosts.backup ?? '')
}

/** The app's own sign-in and privacy routes, placed as routeTree.gen.ts places them. */
async function open(path: string) {
  vi.resetModules()
  const { Route: signIn } = await import('@/routes/(auth)/sign-in')
  const { Route: privacy } = await import('@/routes/privacy')
  const root = createRootRoute()
  const routeTree = root.addChildren([
    signIn.update({ id: '/(auth)/sign-in', path: '/sign-in', getParentRoute: () => root } as never),
    privacy.update({ id: '/privacy', path: '/privacy', getParentRoute: () => root } as never),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) })
  const host = document.body.appendChild(document.createElement('div'))
  const reactRoot = createRoot(host)
  roots.push(reactRoot)
  await act(async () => {
    reactRoot.render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  })
  await act(async () => {
    await router.load()
  })
  return { host, router }
}

describe('the privacy notice', () => {
  it('opens without signing in', async () => {
    demoBuild()
    const { host, router } = await open('/privacy')
    expect(router.state.location.pathname).toBe('/privacy')
    expect(host.querySelector('h1')?.textContent).toBe('Privacy notice')
    expect(host.textContent).toContain('Version of 11 October 2026')
    expect(host.textContent).toContain('What is kept, and why')
    expect(host.querySelector('a[href="/"]')?.textContent).toContain('Back')
  })

  it('is linked from the sign-in screen', async () => {
    demoBuild()
    const { host, router } = await open('/sign-in')
    const link = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Privacy notice')
    expect(link?.getAttribute('href')).toBe('/privacy')
    await act(async () => link!.click())
    expect(router.state.location.pathname).toBe('/privacy')
    expect(host.querySelector('h1')?.textContent).toBe('Privacy notice')
  })

  it('gives the contact the app was built with', async () => {
    demoBuild('  privacy@school.example ')
    const { host } = await open('/privacy')
    expect(host.querySelector('a[href="mailto:privacy@school.example"]')?.textContent).toBe('privacy@school.example')
    expect(host.textContent).toContain('write to the address below')
  })

  it('sends people to the school office when built without a contact, or with one that is not an email address', async () => {
    for (const contact of ['', 'the school office']) {
      demoBuild(contact)
      const { host } = await open('/privacy')
      expect(host.querySelector('a[href^="mailto:"]')).toBeNull()
      expect(host.textContent).toContain('ask your school office.')
      act(() => roots.pop()!.unmount())
    }
  })

  it('says a demo build talks to a demo school, and says nothing of https', async () => {
    demoBuild()
    const { host } = await open('/privacy')
    expect(host.textContent).toContain('This copy of the app is built for a demo school.')
    expect(host.textContent).not.toContain('https')
  })

  it('says https only when the hosted project and the relay are both reached over https', async () => {
    hostedBuild('https://abcdefghijklmnopqrst.supabase.co/functions/v1/relay')
    let { host } = await open('/privacy')
    expect(host.textContent).toContain('This app reaches it over https')
    expect(host.textContent).not.toContain('demo school')
    act(() => roots.pop()!.unmount())

    hostedBuild('http://relay.example/functions/v1/relay')
    ;({ host } = await open('/privacy'))
    expect(host.textContent).not.toContain('https')
  })

  it('names the server its pages come from, and where backups are kept, only when built with them', async () => {
    hostedBuild('', { web: 'Microsoft Azure', backup: ' Microsoft Azure ' })
    let { host } = await open('/privacy')
    expect(host.textContent).toContain('The app’s pages come from a server at Microsoft Azure, which keeps a log')
    expect(host.textContent).toContain('is made and kept with Microsoft Azure.')
    act(() => roots.pop()!.unmount())

    hostedBuild('', { web: 'Microsoft Azure' })
    ;({ host } = await open('/privacy'))
    expect(host.textContent).toContain('a server at Microsoft Azure')
    expect(host.textContent).not.toContain('backup copy')
    act(() => roots.pop()!.unmount())

    hostedBuild('')
    ;({ host } = await open('/privacy'))
    expect(host.textContent).not.toContain('Azure')
  })

  it('names Google Fonts because index.html loads its fonts from there', async () => {
    const index = fs.readFileSync('apps/lms/index.html', 'utf8')
    demoBuild()
    const { host } = await open('/privacy')
    expect(index).toContain('https://fonts.googleapis.com/')
    expect(host.textContent).toContain('The Teacher app loads its fonts from Google Fonts')
  })
})

describe('the sidebar, signed in', () => {
  it('leads teachers and the admin to the privacy notice', async () => {
    demoBuild()
    vi.resetModules()
    const { sidebarFor } = await import('@/components/layout/data/sidebar-data')
    for (const kind of ['teacher', 'admin'] as const) {
      const items = sidebarFor(kind).navGroups.flatMap((g) => g.items)
      expect(items.find((i) => i.url === '/privacy')?.title, kind).toBe('Privacy notice')
    }
  })
})
