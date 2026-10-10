import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRoute, createRouter, Outlet, redirect, RouterProvider } from '@tanstack/react-router'
import { CANNOT_REACH, SOMETHING_WENT_WRONG } from '@ai-tutor/lms-client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * OPENING THE STUDENT AND PARENT APP WITH NO SIGNAL. Written first.
 *
 * The app asks the school who is signed in before it shows anything. Only
 * when the school says the session is over, or the session is not a
 * student's or parent's, does it sign out and go to the sign-in screen. With
 * no signal, or the school's server down, the child stays signed in (their
 * PIN is not needed again), and the page says what went wrong (with no
 * signal, that it could not reach the school), with a way to try again.
 *
 * The real root route and loadMe run here; the backend is a stand-in. The
 * tests' `@` is the teacher app's, so every `@/` module they reach is pointed
 * at the student app's own, or at a stand-in. The `_app` route itself
 * imports the shell, which this config cannot load (privacy.test.tsx), so a
 * route with its beforeLoad (routes/_app/route.tsx) stands in for it.
 */

const aStudent = async (): Promise<unknown> => ({ kind: 'student', userId: 'u1', displayName: 'Riya Sharma' })
const fake = { me: aStudent, session: true, signOuts: 0 }

function pointAtStudentApp() {
  vi.doMock('@/lib/backend', async () => {
    const { friendlyError, isSignedOutError } = await import('@ai-tutor/lms-client')
    return {
      backend: {
        hasSession: async () => fake.session,
        signOut: async () => {
          fake.signOuts += 1
          fake.session = false
        },
      },
      api: { me: () => fake.me() },
      isSignedOutError,
      say: friendlyError,
    }
  })
  vi.doMock('@/lib/brand', () => ({ applyBrand: () => undefined }))
  vi.doMock('@/lib/utils', () => import('../src/lib/utils'))
  vi.doMock('@/stores/auth-store', () => import('../src/stores/auth-store'))
  vi.doMock('@/components/ui/button', () => import('../src/components/ui/button'))
  vi.doMock('@/components/ui/sonner', () => ({ Toaster: () => null }))
}

const roots: Root[] = []
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The router restores scroll on each page; jsdom has no scrolling.
  window.scrollTo = () => undefined
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  fake.me = aStudent
  fake.session = true
  fake.signOuts = 0
})

/** The app's root route, and `_app` as routeTree.gen.ts places it; Home and Sign in stand in for the pages. */
async function open() {
  vi.resetModules()
  pointAtStudentApp()
  const { Route: root } = await import('../src/routes/__root')
  const { loadMe } = await import('../src/stores/auth-store')
  const appRoute = createRoute({
    getParentRoute: () => root,
    id: '_app',
    beforeLoad: async () => {
      const me = await loadMe()
      if (!me) throw redirect({ to: '/sign-in' })
      return { me }
    },
    component: Outlet,
  })
  const routeTree = root.addChildren([
    appRoute.addChildren([
      createRoute({ getParentRoute: () => appRoute, path: '/', component: () => <p>Your homework</p> }),
    ]),
    createRoute({ getParentRoute: () => root, path: '/sign-in', component: () => <p>Sign in</p> }),
  ])
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const host = document.body.appendChild(document.createElement('div'))
  const reactRoot = createRoot(host)
  roots.push(reactRoot)
  await act(async () => {
    reactRoot.render(<RouterProvider router={router} />)
  })
  await act(async () => {
    await router.load()
  })
  return { host, router }
}

describe('opening the app', () => {
  it('with no signal keeps the child signed in, and says it could not reach the school', async () => {
    fake.me = async () => {
      throw new TypeError('Failed to fetch')
    }
    const { host, router } = await open()
    expect(fake.signOuts).toBe(0)
    expect(router.state.location.pathname).toBe('/')
    expect(host.textContent).toContain(CANNOT_REACH)
    expect(host.textContent).not.toContain('Failed to fetch')
  })

  it('tries again from that page, and opens once the school answers', async () => {
    fake.me = async () => {
      throw new TypeError('Failed to fetch')
    }
    const { host } = await open()
    fake.me = aStudent
    const again = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')
    expect(again).toBeDefined()
    await act(async () => again!.click())
    expect(host.textContent).toContain('Your homework')
    expect(fake.signOuts).toBe(0)
  })

  it("with the school's server down keeps the child signed in, and says so in one plain sentence", async () => {
    fake.me = async () => {
      throw new Error('Internal Server Error')
    }
    const { host, router } = await open()
    expect(fake.signOuts).toBe(0)
    expect(router.state.location.pathname).toBe('/')
    expect(host.textContent).toContain(SOMETHING_WENT_WRONG)
  })

  it('signs out, and goes to the sign-in screen, when the school no longer takes the session', async () => {
    for (const words of ['Please sign in again.', 'JWT expired', 'permission denied for function me']) {
      fake.session = true
      fake.signOuts = 0
      fake.me = async () => {
        throw new Error(words)
      }
      const { host, router } = await open()
      expect(fake.signOuts, words).toBe(1)
      expect(router.state.location.pathname, words).toBe('/sign-in')
      expect(host.textContent).toContain('Sign in')
      act(() => roots.pop()!.unmount())
    }
  })

  it("signs out a session that is not a student's or a parent's", async () => {
    fake.me = async () => ({ kind: 'teacher', userId: 't1', displayName: 'Neha Sharma' })
    const { router } = await open()
    expect(fake.signOuts).toBe(1)
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('opens for a signed-in child when the school answers', async () => {
    const { host } = await open()
    expect(host.textContent).toContain('Your homework')
    expect(fake.signOuts).toBe(0)
  })
})
