import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AI_OFF, CANNOT_REACH, friendlyError, isOffline, isSignedOutError } from '@ai-tutor/lms-client'

/**
 * WHICH SCHOOL THE TEACHER APP TALKS TO, decided when it is built. Written
 * first.
 *
 * Built with the hosted project's address and anon key, it signs in through
 * the sign-in guard (lms-signin), keeps its session under a key of its own,
 * sends the admin's import, New PIN and Add parent to lms-admin, and
 * keeps Draft with AI off unless it is given the relay's address. Built
 * without them, it talks to the demo school as before, and only then shows
 * the "School server" setting.
 *
 * The real supabase-js runs here; only the network is faked.
 */

const PROJECT = 'https://abcdefghijklmnopqrst.supabase.co'
const ANON_KEY = 'anon-key-for-tests'

const roots: Root[] = []
/** Whether the faked network is down: every call then fails as fetch does with no signal. */
const network = { offline: false }
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  delete (window as { Capacitor?: unknown }).Capacitor
  network.offline = false
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// Set both ways on purpose: this laptop's .env.local sets the hosted pair for the tutor.
function demoBuild() {
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  vi.stubEnv('VITE_QRIE_RELAY_URL', '')
}
function hostedBuild(relay = '') {
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON_KEY)
  vi.stubEnv('VITE_QRIE_RELAY_URL', relay)
}
async function teacherApp() {
  vi.resetModules()
  return import('@/lib/backend')
}

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const now = () => Math.floor(Date.now() / 1000)
const accessToken = (sub: string) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: now() + 3600 })}.c2lnbmF0dXJl`

interface Call {
  url: string
  method: string
  headers: Headers
  body: Record<string, unknown> | null
}

/** The hosted project's answers, as far as these tests need them. */
function fakeProject() {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body })
    if (network.offline) {
      // auth-js retries a refresh for up to 30 seconds by the clock; a minute
      // passes with each failed try, so it gives up at once, as it would then.
      vi.setSystemTime(Date.now() + 60_000)
      throw new TypeError('Failed to fetch')
    }
    const reply = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
    if (url === `${PROJECT}/functions/v1/lms-signin`) return reply(200, { password: `password-for-${body?.loginId}` })
    const token = /\/auth\/v1\/token\?grant_type=(password|refresh_token)$/.exec(url)
    if (url.startsWith(PROJECT) && token) {
      const sub = token[1] === 'password' ? `user-${body?.email}` : String(body?.refresh_token).replace(/^refresh-/, '')
      return reply(200, {
        access_token: accessToken(sub),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: now() + 3600,
        refresh_token: `refresh-${sub}`,
        user: { id: sub, aud: 'authenticated', role: 'authenticated', email: sub.replace(/^user-/, ''), app_metadata: {}, user_metadata: {}, created_at: '2026-10-10T00:00:00Z' },
      })
    }
    // PostgREST runs an lms function for a signed-in person; called with the
    // anon key, as from nobody, it refuses.
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.startsWith(PROJECT) ? new URL(url).pathname : '')
    if (rpc) {
      if (new Headers(init.headers).get('authorization') === `Bearer ${ANON_KEY}`) {
        return reply(401, { code: '42501', message: `permission denied for function ${rpc[1]}`, details: null, hint: null })
      }
      return reply(200, [])
    }
    if (url === `${PROJECT}/functions/v1/lms-admin/reset-pin`) return reply(200, { loginId: body?.loginId, displayName: 'Asha Verma', pin: '204816' })
    if (url === 'https://relay.example/functions/v1/relay/llm') return reply(200, { choices: [{ message: { content: 'drafted' } }] })
    return reply(404, { message: `nothing at ${url} in this test` })
  })
  return calls
}

const chat = { messages: [{ role: 'user' as const, content: 'Draft two questions.' }] }

describe('the teacher app built without the hosted project', () => {
  it('talks to the demo school at the address it was built with, or one saved on the phone', async () => {
    demoBuild()
    vi.stubEnv('VITE_QRIE_DEMO_URL', 'http://192.168.1.121:54400')
    let app = await teacherApp()
    expect(app.backend.mode).toBe('demo')
    expect(app.DEMO_URL).toBe('http://192.168.1.121:54400')
    localStorage.setItem('qrie-school-server', 'http://10.0.0.2:54400')
    app = await teacherApp()
    expect(app.DEMO_URL).toBe('http://10.0.0.2:54400')
  })

  it('needs both the address and the key: one alone is still the demo', async () => {
    demoBuild()
    vi.stubEnv('VITE_SUPABASE_URL', PROJECT)
    expect((await teacherApp()).backend.mode).toBe('demo')
    demoBuild()
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON_KEY)
    expect((await teacherApp()).backend.mode).toBe('demo')
  })
})

describe('the teacher app built for the hosted project', () => {
  it('signs in through the sign-in guard, then Supabase Auth, and keeps the session under its own key', async () => {
    hostedBuild()
    const calls = fakeProject()
    const { backend } = await teacherApp()
    expect(backend.mode).toBe('supabase')
    expect(await backend.hasSession()).toBe(false)

    await backend.signIn('demo-t01', '493817')

    expect(calls.map((c) => c.url)).toEqual([`${PROJECT}/functions/v1/lms-signin`, `${PROJECT}/auth/v1/token?grant_type=password`])
    expect(calls[0].body).toEqual({ loginId: 'demo-t01', pin: '493817' })
    expect(calls[1].body).toMatchObject({ email: 'demo-t01@login.qrie.invalid', password: 'password-for-demo-t01' })
    expect(calls[1].headers.get('apikey')).toBe(ANON_KEY)
    expect(JSON.parse(localStorage.getItem('qrie-teacher-auth') ?? 'null')).toMatchObject({ refresh_token: 'refresh-user-demo-t01@login.qrie.invalid' })
    expect(await backend.hasSession()).toBe(true)
  })

  it("sends the School Portal's New PIN to lms-admin with the signed-in teacher's token", async () => {
    hostedBuild()
    const calls = fakeProject()
    const { backend } = await teacherApp()
    await backend.signIn('DEMO-ADMIN', '493817')
    calls.length = 0

    expect(await backend.resetPin('DEMO-8A-1')).toEqual({ loginId: 'DEMO-8A-1', displayName: 'Asha Verma', pin: '204816' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${PROJECT}/functions/v1/lms-admin/reset-pin`)
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${accessToken('user-demo-admin@login.qrie.invalid')}`)
  })

  it('keeps Draft with AI off without the relay address, and asks the relay when it has one', async () => {
    hostedBuild()
    let calls = fakeProject()
    let { backend } = await teacherApp()
    await backend.signIn('DEMO-T01', '493817')
    calls.length = 0
    await expect(backend.askAi(chat)).rejects.toThrow(AI_OFF)
    expect(calls).toEqual([])

    localStorage.clear()
    hostedBuild('https://relay.example/functions/v1/relay')
    calls = fakeProject()
    ;({ backend } = await teacherApp())
    await backend.signIn('DEMO-T01', '493817')
    expect(await backend.askAi(chat)).toBe('drafted')
    expect(calls.at(-1)?.url).toBe('https://relay.example/functions/v1/relay/llm')
  })
})

describe('the teacher app built for the hosted project, on a network that drops', () => {
  it('says it could not reach the school, and the failure is one the app retries', async () => {
    hostedBuild()
    fakeProject()
    const { backend, api } = await teacherApp()
    await backend.signIn('DEMO-T01', '493817')
    network.offline = true
    const error = await api.myClasses().then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect(friendlyError(error)).toBe(CANNOT_REACH)
    expect(isOffline(error)).toBe(true)
  })

  it('keeps a session it could not refresh, and sends nothing in its place when the network is back', async () => {
    hostedBuild()
    const calls = fakeProject()
    const { backend, api } = await teacherApp()
    await backend.signIn('DEMO-T01', '493817')
    // The next morning, with no network: the access token is past its time
    // and cannot be refreshed. The session is still the teacher's.
    vi.setSystemTime(Date.now() + 12 * 3600_000)
    network.offline = true
    expect(await backend.hasSession()).toBe(true)
    // The network back within the minute auth-js waits before it tries to
    // refresh again: supabase-js has no token to send meanwhile.
    network.offline = false
    calls.length = 0
    const error = await api.myClasses().then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect(isSignedOutError(error)).toBe(false)
    expect(calls).toEqual([])
    // Once it tries again, the call goes with the teacher's own token.
    vi.setSystemTime(Date.now() + 2 * 60_000)
    expect(await api.myClasses()).toEqual([])
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/auth/v1/token', '/rest/v1/rpc/my_classes'])
    expect(calls[1].headers.get('authorization')).not.toBe(`Bearer ${ANON_KEY}`)
  })

  it('forgets the session on signing out, even when supabase-js cannot finish signing out', async () => {
    hostedBuild()
    fakeProject()
    let { backend } = await teacherApp()
    await backend.signIn('DEMO-T01', '493817')
    // Hours later, with no network: the access token is past its time and
    // cannot be refreshed, and supabase-js's own sign-out stops there.
    vi.setSystemTime(Date.now() + 12 * 3600_000)
    network.offline = true
    await backend.signOut().catch(() => undefined)
    // Back online, the app opened afresh by whoever uses the computer next.
    network.offline = false
    ;({ backend } = await teacherApp())
    expect(await backend.hasSession()).toBe(false)
    expect(Object.keys(localStorage).filter((k) => k.startsWith('qrie-teacher-auth'))).toEqual([])
  })
})

describe('the "School server" setting on the sign-in screen', () => {
  const phone = () => {
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
  }
  async function render() {
    vi.resetModules()
    const { ServerSetting } = await import('@/components/server-setting')
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

describe("the teacher app's word for a session that is over", () => {
  it("recognises the hosted project's words as well as the demo's", async () => {
    demoBuild()
    const { isSignedOutError } = await teacherApp()
    for (const m of ['Please sign in again.', 'JWT expired', 'permission denied for function me', 'not signed in']) {
      expect(isSignedOutError(new Error(m)), m).toBe(true)
    }
    for (const m of ["That ID and PIN don't match.", 'this is not your class', 'TypeError: Failed to fetch']) {
      expect(isSignedOutError(new Error(m)), m).toBe(false)
    }
  })
})
