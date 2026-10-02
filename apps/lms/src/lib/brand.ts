import { useQuery } from '@tanstack/react-query'
import { readableOn, type Me } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'

const HEX = /^#[0-9a-f]{6}$/i

/** Qrie's own pair (blue and amber), worn by a school that has not chosen its own. */
export const QRIE_COLOURS = { primary: '#0b5fd9', accent: '#ffc85c' } as const

export { readableOn }

/** The signed-in person's school colours, each #rrggbb, falling back to Qrie's. */
export function brandColours(me: Me | null): { primary: string; accent: string } {
  const pick = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
  return {
    primary: pick(me?.brand?.primary, QRIE_COLOURS.primary),
    accent: pick(me?.brand?.accent, QRIE_COLOURS.accent),
  }
}

/**
 * The school's colours on the teacher app, as on the student app
 * (apps/student/src/lib/brand.ts): `primary` for what is pressed and the
 * first chart series, `accent` for highlights, each with black or white text
 * chosen for contrast.
 */
export function applyBrand(me: Me | null): void {
  const root = document.documentElement
  const { primary, accent } = brandColours(me)
  const set = (name: string, value: string) => root.style.setProperty(name, value)
  set('--primary', primary)
  set('--primary-foreground', readableOn(primary))
  set('--ring', primary)
  set('--sidebar-primary', primary)
  set('--sidebar-primary-foreground', readableOn(primary))
  set('--chart-1', primary)
  set('--brand-accent', accent)
  set('--brand-accent-foreground', readableOn(accent))
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
