import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseSchoolAppConfig, SCHOOL_APP_DEFAULTS, type SchoolAppConfig } from '@ai-tutor/lms-client'
import { backend } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth-store'
import { AppNotices } from '@/components/app-notices'
import { STUDENT_BUILD } from '@/lib/build'

/**
 * Qrie control's switches for this school, or the platform's before sign-in
 * (public.app_config through the backend). Read at start, every five minutes
 * and when the app is shown again (TanStack Query's focus refetch). A failed
 * read keeps the last good answer, or SCHOOL_APP_DEFAULTS: nothing turns on.
 */
export function useStudentAppConfig(): SchoolAppConfig {
  const code = useAuthStore((s) => s.me?.schoolCode ?? null)
  const q = useQuery({
    queryKey: ['app-config', code ?? '-'],
    queryFn: () => backend.appConfig(code),
    refetchInterval: 300_000,
    refetchOnWindowFocus: true,
    retry: 1,
    placeholderData: (previous) => previous,
  })
  return q.data === undefined ? SCHOOL_APP_DEFAULTS : parseSchoolAppConfig(q.data, 'student')
}

export function AppGate({ children }: { children: ReactNode }) {
  return (
    <AppNotices config={useStudentAppConfig()} build={STUDENT_BUILD}>
      {children}
    </AppNotices>
  )
}
