import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ServerSetting } from '../src/components/server-setting'
import { SERVER_KEY, savedServer } from '../src/lib/server'

/**
 * Where the phone app finds the school's server. The Android build is made
 * with one address (the laptop's on the Wi-Fi); should that change, the sign-in
 * screen lets it be set again, without a new build. On the web the app is
 * served beside its server and shows nothing of this.
 */

const roots: Root[] = []
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  delete (window as { Capacitor?: unknown }).Capacitor
})

async function render(onSaved = vi.fn()) {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<ServerSetting current='http://192.168.1.5:54400' onSaved={onSaved} />))
  return { host, onSaved }
}
const phone = () => {
  ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
}
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!

describe("the school server's address", () => {
  it('is not shown on the web', async () => {
    const { host } = await render()
    expect(host.textContent).toBe('')
  })

  it('is shown in the phone app, and saved when changed to an address', async () => {
    phone()
    const { host, onSaved } = await render()
    expect(host.textContent).toContain('http://192.168.1.5:54400')
    await act(async () => button(host, 'Change').click())
    const input = host.querySelector<HTMLInputElement>('input')!
    await type(input, '  http://192.168.1.9:54400/ ')
    await act(async () => button(host, 'Save').click())
    expect(savedServer()).toBe('http://192.168.1.9:54400')
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('refuses what is not an address, and saves nothing', async () => {
    phone()
    const { host, onSaved } = await render()
    await act(async () => button(host, 'Change').click())
    await type(host.querySelector<HTMLInputElement>('input')!, '192.168.1.9 54400')
    await act(async () => button(host, 'Save').click())
    expect(host.textContent).toContain('like http://192.168.1.5:54400')
    expect(localStorage.getItem(SERVER_KEY)).toBeNull()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('goes back to the address the app was built with', async () => {
    phone()
    localStorage.setItem(SERVER_KEY, 'http://10.0.0.2:54400')
    const { host, onSaved } = await render()
    await act(async () => button(host, 'Change').click())
    await act(async () => button(host, 'Use the built-in address').click())
    expect(savedServer()).toBeNull()
    expect(onSaved).toHaveBeenCalledOnce()
  })
})
