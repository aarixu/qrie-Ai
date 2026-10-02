import { useQuery } from '@tanstack/react-query'
import { readableOn, type Me } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'

const HEX = /^#[0-9a-f]{6}$/i

/** Qrie's own pair (blue and amber), worn by a school that has not chosen its own. */
export const QRIE_COLOURS = { primary: '#0b5fd9', accent: '#ffc85c' } as const

/** The signed-in student's school colours, each #rrggbb, falling back to Qrie's. */
export function brandColours(me: Me | null): { primary: string; accent: string } {
  const pick = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
  return {
    primary: pick(me?.brand?.primary, QRIE_COLOURS.primary),
    accent: pick(me?.brand?.accent, QRIE_COLOURS.accent),
  }
}

/**
 * The white label: one app, dressed in the signed-in student's school — its
 * `primary` colour for what is pressed, its `accent` for highlights, each
 * with black or white text chosen for contrast — and Qrie's own pair before
 * anybody signs in or when the school has chosen none.
 */
export function applyBrand(me: Me | null): void {
  const root = document.documentElement
  const { primary, accent } = brandColours(me)
  root.style.setProperty('--primary', primary)
  root.style.setProperty('--primary-foreground', readableOn(primary))
  root.style.setProperty('--brand-primary', primary)
  root.style.setProperty('--brand-accent', accent)
  root.style.setProperty('--brand-accent-foreground', readableOn(accent))
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
