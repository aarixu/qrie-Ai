import { create } from 'zustand'
import type { Me } from '@ai-tutor/lms-client'
import { api, backend } from '@/lib/backend'
import { applyBrand } from '@/lib/brand'

interface AuthState {
  me: Me | null
  setMe: (me: Me | null) => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  me: null,
  setMe: (me) => {
    applyBrand(me)
    set({ me })
  },
}))

export const NOT_A_STUDENT =
  'This app is for students and parents. Teachers sign in to Qrie for teachers.'

/** Who this app is for: a student, or a parent (0045). */
export const forThisApp = (me: Me | null): me is Me => !!me && (me.kind === 'student' || me.kind === 'parent')

/** The signed-in student or parent, loading them if needed; null when nobody is. */
export async function loadMe(): Promise<Me | null> {
  const known = useAuthStore.getState().me
  if (known) return known
  if (!(await backend.hasSession())) return null
  try {
    const me = await api.me()
    if (!forThisApp(me)) {
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
