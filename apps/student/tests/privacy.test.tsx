import fs from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * THE PRIVACY NOTICE IN THE STUDENT AND PARENT APP, at /privacy. Written
 * first.
 *
 * Reached without signing in, from the sign-in screen, and when signed in
 * from the shield in the header of every screen that has one. The contact is
 * the address the app was built with (VITE_QRIE_PRIVACY_CONTACT); without one,
 * the notice sends people to the school office. The text itself is
 * packages/lms-client's (tests/privacy.test.ts); here, what this app tells it
 * about its own build.
 *
 * The tests' `@` is the teacher app's, so every `@/` module the sign-in
 * screen and the notice reach is pointed back at the student app's own. The
 * header (components/shell.tsx) also reaches student modules the teacher app
 * has no file for, which this config cannot load at all, so its link is
 * checked in its source.
 */

// Again after every reset, so each build's own backend is the one reached.
function pointAtStudentApp() {
  vi.doMock('@/lib/backend', () => import('../src/lib/backend'))
  vi.doMock('@/lib/brand', () => import('../src/lib/brand'))
  vi.doMock('@/lib/utils', () => import('../src/lib/utils'))
  vi.doMock('@/stores/auth-store', () => import('../src/stores/auth-store'))
  vi.doMock('@/assets/logo', () => import('../src/assets/logo'))
  vi.doMock('@/components/server-setting', () => import('../src/components/server-setting'))
  vi.doMock('@/components/ui/alert', () => import('../src/components/ui/alert'))
  vi.doMock('@/components/ui/button', () => import('../src/components/ui/button'))
  vi.doMock('@/components/ui/input', () => import('../src/components/ui/input'))
  vi.doMock('@/components/ui/label', () => import('../src/components/ui/label'))
}

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
  vi.unstubAllGlobals()
})

// Set both ways on purpose: this laptop's .env.local sets the hosted pair for the tutor.
function demoBuild(contact = '') {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  vi.stubEnv('VITE_QRIE_PRIVACY_CONTACT', contact)
}
function hostedBuild(url = PROJECT) {
  vi.stubEnv('VITE_SUPABASE_URL', url)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests')
  vi.stubEnv('VITE_QRIE_PRIVACY_CONTACT', '')
}

/** The app's sign-in screen and notice at the paths routeTree.gen.ts gives them; Home stands in for the rest. */
async function open(path: string) {
  vi.resetModules()
  pointAtStudentApp()
  // Nothing here should reach a server; any call that tries finds none.
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
  const { SignIn } = await import('../src/features/sign-in')
  const { Privacy } = await import('../src/features/privacy')
  const root = createRootRoute()
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/', component: () => <p>Home</p> }),
    createRoute({ getParentRoute: () => root, path: '/sign-in', component: SignIn }),
    createRoute({ getParentRoute: () => root, path: '/privacy', component: Privacy }),
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
    expect(host.textContent).toContain('Version of 10 October 2026')
    expect(host.textContent).toContain('What is kept, and why')
    expect(host.querySelector('a[href="/"]')?.textContent).toContain('Back')
  })

  it('is linked from the sign-in screen', async () => {
    demoBuild()
    const { host, router } = await open('/sign-in')
    expect(host.textContent).toContain('Sign in with the ID and PIN your school gave you.')
    const link = [...host.querySelectorAll('a')].find((a) => a.textContent === 'Privacy notice')
    expect(link?.getAttribute('href')).toBe('/privacy')
    await act(async () => link!.click())
    expect(router.state.location.pathname).toBe('/privacy')
    expect(host.querySelector('h1')?.textContent).toBe('Privacy notice')
  })

  it('is linked from the header of the signed-in screens', () => {
    const shell = fs.readFileSync('apps/student/src/components/shell.tsx', 'utf8')
    const header = /<header[\s\S]*?<\/header>/.exec(shell)?.[0] ?? ''
    expect(header).toMatch(/<Link\s+to='\/privacy'\s+aria-label='Privacy notice'/)
  })

  it('gives the contact the app was built with', async () => {
    demoBuild('privacy@school.example')
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

  it('says https only when the hosted project is reached over https', async () => {
    hostedBuild()
    let { host } = await open('/privacy')
    expect(host.textContent).toContain('This app reaches it over https')
    expect(host.textContent).not.toContain('demo school')
    act(() => roots.pop()!.unmount())

    hostedBuild('http://192.168.1.5:54321')
    ;({ host } = await open('/privacy'))
    expect(host.textContent).not.toContain('https')
  })

  it('does not name Google Fonts: index.html loads nothing from there', async () => {
    const index = fs.readFileSync('apps/student/index.html', 'utf8')
    demoBuild()
    const { host } = await open('/privacy')
    expect(index).not.toContain('fonts.googleapis.com')
    expect(host.textContent).not.toContain('Google Fonts')
  })
})
