import { useQuery } from '@tanstack/react-query'
import { readableOn, type Me } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'

const HEX = /^#[0-9a-f]{6}$/i
const VARS = ['--primary', '--primary-foreground', '--ring', '--sidebar-primary', '--sidebar-primary-foreground']

export { readableOn }

/**
 * The school's colour on the teacher app, as on the student app
 * (apps/student/src/lib/brand.ts): `brand.primary` when it is a #rrggbb
 * colour, and the app's own colours otherwise.
 */
export function applyBrand(me: Me | null): void {
  const root = document.documentElement
  const primary = me?.brand?.primary
  if (typeof primary === 'string' && HEX.test(primary)) {
    const text = readableOn(primary)
    root.style.setProperty('--primary', primary)
    root.style.setProperty('--primary-foreground', text)
    root.style.setProperty('--ring', primary)
    root.style.setProperty('--sidebar-primary', primary)
    root.style.setProperty('--sidebar-primary-foreground', text)
  } else {
    for (const v of VARS) root.style.removeProperty(v)
  }
}

/** The school's logo as an address an <img> can show, or null (lms.school_logo). */
export function useSchoolLogo(enabled = true): string | null {
  const logo = useQuery({
    queryKey: ['school-logo'],
    queryFn: api.schoolLogo,
    enabled,
    staleTime: 10 * 60_000,
  })
  return logo.data ? `data:${logo.data.mime};base64,${logo.data.base64}` : null
}
