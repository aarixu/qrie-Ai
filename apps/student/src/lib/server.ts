/**
 * Where the app finds the school's server. The phone app is built with one
 * address (its VITE_QRIE_DEMO_URL: the laptop's on the Wi-Fi, for the demo);
 * one set on the sign-in screen (components/server-setting.tsx) takes its
 * place, kept on the phone.
 */
export const SERVER_KEY = 'qrie-school-server'

/** An address: http(s), a host and maybe a port, nothing after. */
export const SERVER_ADDRESS = /^https?:\/\/[^\s/?#]+$/i

export function savedServer(): string | null {
  try {
    return localStorage.getItem(SERVER_KEY)
  } catch {
    return null
  }
}

export function saveServer(address: string | null): void {
  try {
    if (address) localStorage.setItem(SERVER_KEY, address)
    else localStorage.removeItem(SERVER_KEY)
  } catch {
    /* a phone that keeps nothing keeps the built-in address */
  }
}

/** Whether this is the Android app (its WebView carries Capacitor's bridge), not a browser. */
export function inPhoneApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()
}
