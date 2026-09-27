import { useQuery } from '@tanstack/react-query'
import { readableOn, type Me } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'

const HEX = /^#[0-9a-f]{6}$/i

/**
 * The white label: one app, dressed in the signed-in student's school. The
 * school's record may carry `brand.primary` (a #rrggbb colour); anything
 * else in it is ignored, and without it the app keeps Qrie's own colours.
 */
export function applyBrand(me: Me | null): void {
  const root = document.documentElement
  const primary = me?.brand?.primary
  if (typeof primary === 'string' && HEX.test(primary)) {
    root.style.setProperty('--primary', primary)
    root.style.setProperty('--primary-foreground', readableOn(primary))
    root.style.setProperty('--ring', primary)
  } else {
    root.style.removeProperty('--primary')
    root.style.removeProperty('--primary-foreground')
    root.style.removeProperty('--ring')
  }
  document.title = me ? me.schoolName : 'Qrie'
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
