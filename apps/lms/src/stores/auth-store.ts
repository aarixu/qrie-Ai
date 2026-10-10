import { create } from 'zustand'
import type { Me } from '@ai-tutor/lms-client'
import { api, backend, isSignedOutError } from '@/lib/backend'
import { applyBrand } from '@/lib/brand'

/**
 * Who is signed in, as the school's records say (lms.me). The session token
 * itself is the backend's; this only remembers the answer to "who am I".
 */
interface AuthState {
  me: Me | null
  setMe: (me: Me | null) => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  me: null,
  // The school's colour follows whoever is signed in.
  setMe: (me) => {
    applyBrand(me)
    set({ me })
  },
}))

export const NOT_A_TEACHER =
  'This app is for teachers. Students sign in to the Qrie student app.'

/**
 * The signed-in teacher, loading them if needed; null when nobody is, once
 * signed out here when the school no longer takes the session or it is a
 * student's. Any other failure (no network, the school's server down) is
 * thrown, and the session kept: the page says it could not load, and no PIN
 * is needed to carry on once the school answers.
 */
export async function loadMe(): Promise<Me | null> {
  const known = useAuthStore.getState().me
  if (known) return known
  if (!(await backend.hasSession())) return null
  let me: Me | null
  try {
    me = await api.me()
  } catch (error) {
    if (!isSignedOutError(error)) throw error
    await backend.signOut().catch(() => undefined)
    return null
  }
  if (!me || me.kind === 'student') {
    await backend.signOut().catch(() => undefined)
    return null
  }
  useAuthStore.getState().setMe(me)
  return me
}

export async function signOut(): Promise<void> {
  await backend.signOut().catch(() => undefined)
  useAuthStore.getState().setMe(null)
}
