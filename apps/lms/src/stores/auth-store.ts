import { create } from 'zustand'
import type { Me } from '@ai-tutor/lms-client'
import { api, backend } from '@/lib/backend'

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
  setMe: (me) => set({ me }),
}))

export const NOT_A_TEACHER =
  'This app is for teachers. Students sign in to the Qrie student app.'

/**
 * The signed-in teacher, loading them if needed; null when nobody is, or
 * when the session is a student's (who is then signed out here).
 */
export async function loadMe(): Promise<Me | null> {
  const known = useAuthStore.getState().me
  if (known) return known
  if (!(await backend.hasSession())) return null
  try {
    const me = await api.me()
    if (!me || me.kind === 'student') {
      await backend.signOut()
      return null
    }
    useAuthStore.getState().setMe(me)
    return me
  } catch {
    await backend.signOut().catch(() => undefined)
    return null
  }
}

export async function signOut(): Promise<void> {
  await backend.signOut().catch(() => undefined)
  useAuthStore.getState().setMe(null)
}
