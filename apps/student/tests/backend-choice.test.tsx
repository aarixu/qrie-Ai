import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AI_OFF } from '@ai-tutor/lms-client'

/**
 * WHICH SCHOOL THE STUDENT AND PARENT APP TALKS TO, decided when it is built.
 * Written first.
 *
 * Built with the hosted project's address and anon key, it signs in through
 * the sign-in guard (lms-signin) and keeps its session under a key of its
 * own, so a teacher signed in to the teacher app in the same browser is not
 * signed in here. It is given neither lms-admin nor the relay: nothing in it
 * adds people, gives PINs or asks the AI. Built without them, it talks to the
 * demo school as before, and only then shows the "School server" setting.
 *
 * The real supabase-js runs here; only the network is faked. (Student code is
 * imported by relative paths: the tests' `@` is the teacher app's.)
 */

const PROJECT = 'https://abcdefghijklmnopqrst.supabase.co'
const ANON_KEY = 'anon-key-for-tests'

const roots: Root[] = []
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  delete (window as { Capacitor?: unknown }).Capacitor
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
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON_KEY)
  // Set, to show this app does not read it.
  vi.stubEnv('VITE_QRIE_RELAY_URL', 'https://relay.example/functions/v1/relay')
}
async function studentApp() {
  vi.resetModules()
  return import('../src/lib/backend')
}

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const now = () => Math.floor(Date.now() / 1000)
const accessToken = (sub: string) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: now() + 3600 })}.c2lnbmF0dXJl`

interface Call {
  url: string
  headers: Headers
  body: Record<string, unknown> | null
}

/** The hosted project's answers, as far as these tests need them. */
function fakeProject() {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ url, headers: new Headers(init.headers), body })
    const reply = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
    if (url === `${PROJECT}/functions/v1/lms-signin`) return reply(200, { password: `password-for-${body?.loginId}` })
    if (url === `${PROJECT}/auth/v1/token?grant_type=password`) {
      const sub = `user-${body?.email}`
      return reply(200, {
        access_token: accessToken(sub),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: now() + 3600,
        refresh_token: `refresh-${sub}`,
        user: { id: sub, aud: 'authenticated', role: 'authenticated', email: body?.email, app_metadata: {}, user_metadata: {}, created_at: '2026-10-10T00:00:00Z' },
      })
    }
    return reply(404, { message: `nothing at ${url} in this test` })
  })
  return calls
}

describe('the student app built without the hosted project', () => {
  it('talks to the demo school at the address it was built with, or one saved on the phone', async () => {
    demoBuild()
    vi.stubEnv('VITE_QRIE_DEMO_URL', 'http://192.168.1.121:54400')
    let app = await studentApp()
    expect(app.backend.mode).toBe('demo')
    expect(app.DEMO_URL).toBe('http://192.168.1.121:54400')
    localStorage.setItem('qrie-school-server', 'http://10.0.0.2:54400')
    app = await studentApp()
    expect(app.DEMO_URL).toBe('http://10.0.0.2:54400')
  })

  it('needs both the address and the key: one alone is still the demo', async () => {
    demoBuild()
    vi.stubEnv('VITE_SUPABASE_URL', PROJECT)
    expect((await studentApp()).backend.mode).toBe('demo')
    demoBuild()
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON_KEY)
    expect((await studentApp()).backend.mode).toBe('demo')
  })
})

describe('the student app built for the hosted project', () => {
  it('signs in through the sign-in guard, then Supabase Auth, and keeps the session under its own key', async () => {
    hostedBuild()
    const calls = fakeProject()
    const { backend } = await studentApp()
    expect(backend.mode).toBe('supabase')

    await backend.signIn('DEMO-8A-1', '493817')

    expect(calls.map((c) => c.url)).toEqual([`${PROJECT}/functions/v1/lms-signin`, `${PROJECT}/auth/v1/token?grant_type=password`])
    expect(calls[0].body).toEqual({ loginId: 'DEMO-8A-1', pin: '493817' })
    expect(calls[1].body).toMatchObject({ email: 'demo-8a-1@login.qrie.invalid', password: 'password-for-DEMO-8A-1' })
    expect(calls[1].headers.get('apikey')).toBe(ANON_KEY)
    expect(JSON.parse(localStorage.getItem('qrie-school-auth') ?? 'null')).toMatchObject({ refresh_token: 'refresh-user-demo-8a-1@login.qrie.invalid' })
    expect(await backend.hasSession()).toBe(true)
  })

  it('reaches neither lms-admin nor the AI', async () => {
    hostedBuild()
    const calls = fakeProject()
    const { backend } = await studentApp()
    await backend.signIn('DEMO-8A-1', '493817')
    calls.length = 0
    await expect(backend.resetPin('DEMO-8A-2')).rejects.toThrow(/not set up/)
    await expect(backend.askAi({ messages: [{ role: 'user', content: 'Answer my homework.' }] })).rejects.toThrow(AI_OFF)
    expect(calls).toEqual([])
  })

  it("keeps its session apart from the teacher app's in the same browser", async () => {
    hostedBuild()
    fakeProject()
    vi.resetModules()
    const teacher = await import('../../lms/src/lib/backend')
    const student = await import('../src/lib/backend')

    await teacher.backend.signIn('DEMO-T01', '493817')
    expect(await teacher.backend.hasSession()).toBe(true)
    expect(await student.backend.hasSession()).toBe(false)

    await student.backend.signIn('DEMO-8A-1', '493817')
    const kept = (key: string) => (JSON.parse(localStorage.getItem(key) ?? 'null') as { user?: { email?: string } } | null)?.user?.email
    expect(kept('qrie-teacher-auth')).toBe('demo-t01@login.qrie.invalid')
    expect(kept('qrie-school-auth')).toBe('demo-8a-1@login.qrie.invalid')
  })
})

describe('the "School server" setting on the sign-in screen', () => {
  const phone = () => {
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
  }
  async function render() {
    vi.resetModules()
    const { ServerSetting } = await import('../src/components/server-setting')
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    roots.push(root)
    await act(async () => root.render(<ServerSetting current='http://192.168.1.5:54400' />))
    return host
  }

  it('is shown in the phone app built for the demo school', async () => {
    demoBuild()
    phone()
    expect((await render()).textContent).toContain('School server: http://192.168.1.5:54400')
  })

  it('is not shown at all in a build for the hosted project, even in the phone app', async () => {
    hostedBuild()
    phone()
    localStorage.setItem('qrie-school-server', 'http://10.0.0.2:54400')
    expect((await render()).textContent).toBe('')
  })
})

describe("the student app's word for a session that is over", () => {
  it("recognises the hosted project's words as well as the demo's", async () => {
    demoBuild()
    const { isSignedOutError } = await studentApp()
    for (const m of ['Please sign in again.', 'JWT expired', 'permission denied for function my_assignments', 'not signed in']) {
      expect(isSignedOutError(new Error(m)), m).toBe(true)
    }
    for (const m of ["That ID and PIN don't match.", 'no attempts left for this homework', 'TypeError: Failed to fetch']) {
      expect(isSignedOutError(new Error(m)), m).toBe(false)
    }
  })
})
