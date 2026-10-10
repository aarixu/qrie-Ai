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
import { CANNOT_REACH } from '@ai-tutor/lms-client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * WHAT THE STUDENT AND PARENT APP'S SIGN-IN SCREEN SUGGESTS AN ID LOOKS LIKE.
 * Written first.
 *
 * The demo school's IDs (DEMO-8A-1) are the example only in a build for the
 * demo school. A build for a real school gives no example and points to the
 * slip, which carries the ID the school made; packages/lms-client/src/login.ts
 * holds an ID only to letters, digits and dashes.
 *
 * The tests' `@` is the teacher app's, so every `@/` module the sign-in
 * screen reaches is pointed back at the student app's own.
 */

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
function demoBuild() {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
}
function hostedBuild() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests')
}

async function openSignIn() {
  vi.resetModules()
  pointAtStudentApp()
  const { SignIn } = await import('../src/features/sign-in')
  const root = createRootRoute()
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/', component: () => <p>Home</p> }),
    createRoute({ getParentRoute: () => root, path: '/sign-in', component: SignIn }),
  ])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/sign-in'] }) })
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
  return host
}

/** Types into an input the way a person does, so React hears it. */
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function signIn(host: HTMLElement, id: string, pin: string) {
  await act(async () => type(host.querySelector<HTMLInputElement>('#id')!, id))
  await act(async () => type(host.querySelector<HTMLInputElement>('#pin')!, pin))
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Sign in')!
  await act(async () => button.click())
}

const alertText = (host: HTMLElement) => host.querySelector('[role="alert"]')?.textContent ?? ''

describe("the sign-in screen's example of an ID", () => {
  it('is the demo school’s in a build for the demo school', async () => {
    demoBuild()
    const host = await openSignIn()
    expect(host.querySelector('#id')?.getAttribute('placeholder')).toBe('DEMO-8A-1')
    await signIn(host, 'x', '')
    expect(alertText(host)).toBe('Type the ID on your slip, like DEMO-8A-1.')
  })

  it('is not given in a build for a real school, which names no demo ID anywhere', async () => {
    hostedBuild()
    const host = await openSignIn()
    expect(host.querySelector('#id')?.hasAttribute('placeholder')).toBe(false)
    await signIn(host, 'x', '')
    expect(alertText(host)).toBe('Type the ID on your slip.')
    expect(host.textContent).not.toContain('DEMO')
  })

  it('says it could not reach the school when a real school’s build has no signal', async () => {
    hostedBuild()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const host = await openSignIn()
    await signIn(host, 'abc-8a-1', '493817')
    expect(alertText(host)).toBe(CANNOT_REACH)
  })
})
