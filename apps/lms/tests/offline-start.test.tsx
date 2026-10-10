import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { CANNOT_REACH } from '@ai-tutor/lms-client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * OPENING THE TEACHER APP WITH NO NETWORK. Written first.
 *
 * The app asks the school who is signed in before it shows anything. Only
 * when the school says the session is over, or the session is a student's,
 * does it sign out and go to the sign-in screen. With no network,
 * or the school's server down, the teacher stays signed in (no PIN needed
 * again), and the page says why it could not load.
 *
 * The real root and `_authenticated` routes and loadMe run here; the backend
 * is a stand-in, and so is the signed-in layout around the page.
 */

const aTeacher = async (): Promise<unknown> => ({ kind: 'teacher', userId: 't1', displayName: 'Neha Sharma' })
const fake = { me: aTeacher, session: true, signOuts: 0 }

function standIns() {
  vi.doMock('@/lib/backend', async () => {
    const { isSignedOutError } = await import('@ai-tutor/lms-client')
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
    }
  })
  vi.doMock('@/lib/brand', () => ({ applyBrand: () => undefined }))
  vi.doMock('@/components/ui/sonner', () => ({ Toaster: () => null }))
  vi.doMock('@/components/layout/authenticated-layout', async () => {
    const { Outlet } = await import('@tanstack/react-router')
    return { AuthenticatedLayout: () => <Outlet /> }
  })
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
  fake.me = aTeacher
  fake.session = true
  fake.signOuts = 0
})

/** The app's root and `_authenticated` routes as routeTree.gen.ts places them; Home and Sign in stand in for the pages. */
async function open() {
  vi.resetModules()
  standIns()
  const { Route: root } = await import('@/routes/__root')
  const { Route: authenticated } = await import('@/routes/_authenticated/route')
  const signedIn = authenticated.update({ id: '/_authenticated', getParentRoute: () => root } as never)
  const routeTree = root.addChildren([
    signedIn.addChildren([
      createRoute({ getParentRoute: () => signedIn, path: '/', component: () => <p>Your classes</p> }),
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

describe('opening the teacher app', () => {
  it('with no network keeps the teacher signed in, and says it could not reach the school', async () => {
    fake.me = async () => {
      throw new TypeError('Failed to fetch')
    }
    const { host, router } = await open()
    expect(fake.signOuts).toBe(0)
    expect(router.state.location.pathname).toBe('/')
    expect(host.textContent).toContain('This page could not load')
    expect(host.textContent).toContain(CANNOT_REACH)
  })

  it("with the school's server down keeps the teacher signed in", async () => {
    fake.me = async () => {
      throw new Error('Internal Server Error')
    }
    const { host, router } = await open()
    expect(fake.signOuts).toBe(0)
    expect(router.state.location.pathname).toBe('/')
    expect(host.textContent).toContain('This page could not load')
    expect(host.textContent).not.toContain(CANNOT_REACH)
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

  it("signs out a student's session", async () => {
    fake.me = async () => ({ kind: 'student', userId: 'u1', displayName: 'Riya Sharma' })
    const { router } = await open()
    expect(fake.signOuts).toBe(1)
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('opens for a signed-in teacher when the school answers', async () => {
    const { host } = await open()
    expect(host.textContent).toContain('Your classes')
    expect(fake.signOuts).toBe(0)
  })
})
