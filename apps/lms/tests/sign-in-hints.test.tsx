import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { CANNOT_REACH } from '@ai-tutor/lms-client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * WHAT THE TEACHER APP'S SIGN-IN SCREEN SUGGESTS AN ID LOOKS LIKE. Written
 * first.
 *
 * The demo school's IDs (DEMO-T01) are the example only in a build for the
 * demo school. A build for a real school gives no example: the slip carries
 * the ID the school made, and packages/lms-client/src/login.ts holds an ID
 * only to letters, digits and dashes. Nor does it ask whether the school's
 * server "is running" when the network drops: that is the demo's laptop.
 */

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
  vi.stubEnv('VITE_QRIE_RELAY_URL', '')
}
function hostedBuild() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests')
  vi.stubEnv('VITE_QRIE_RELAY_URL', '')
}

/** The app's own sign-in route, placed as routeTree.gen.ts places it. */
async function openSignIn() {
  vi.resetModules()
  const { Route: signIn } = await import('@/routes/(auth)/sign-in')
  const root = createRootRoute()
  const routeTree = root.addChildren([
    signIn.update({ id: '/(auth)/sign-in', path: '/sign-in', getParentRoute: () => root } as never),
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

const idInput = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[autocomplete="username"]')!

async function signIn(host: HTMLElement, id: string, pin: string) {
  await act(async () => type(idInput(host), id))
  await act(async () => type(host.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!, pin))
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Sign in')!
  await act(async () => button.click())
  // The form checks what was typed, then calls the school, before it answers.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
}

describe("the sign-in screen's example of an ID", () => {
  it('is the demo school’s in a build for the demo school', async () => {
    demoBuild()
    const host = await openSignIn()
    expect(idInput(host).getAttribute('placeholder')).toBe('DEMO-T01')
    await signIn(host, 'x', '493817')
    expect(host.textContent).toContain('An ID is letters, digits and dashes, like DEMO-T01.')
  })

  it('is not given in a build for a real school, which names no demo ID anywhere', async () => {
    hostedBuild()
    const host = await openSignIn()
    expect(idInput(host).hasAttribute('placeholder')).toBe(false)
    await signIn(host, 'x', '493817')
    expect(host.textContent).toContain('An ID is letters, digits and dashes.')
    expect(host.textContent).not.toContain('DEMO')
  })
})

describe('signing in with no network', () => {
  const offline = () =>
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

  it("asks after the demo's server in a build for the demo school", async () => {
    demoBuild()
    offline()
    const host = await openSignIn()
    await signIn(host, 'demo-t01', '493817')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not reach the school server. Is it running?')
  })

  it('says it could not reach the school in a build for a real school', async () => {
    hostedBuild()
    offline()
    const host = await openSignIn()
    await signIn(host, 'abc-t01', '493817')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(CANNOT_REACH)
  })
})
