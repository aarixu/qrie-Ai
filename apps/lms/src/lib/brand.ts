import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { readableOn, type Me, type SchoolPublicBrand } from '@ai-tutor/lms-client'
import { api, backend } from '@/lib/backend'

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
 * (apps/student/src/lib/brand.ts): `primary` for what is pressed, the
 * sidebar and the focus ring, `accent` for highlights, each with black or
 * white text chosen for contrast. Charts keep one colour per measure
 * (features/analytics/charts.tsx MEASURE), whatever the school's.
 */
export function applyBrand(me: Me | null): void {
  applyColours(me?.brand?.primary, me?.brand?.accent)
}

/** The colours themselves, each falling back to Qrie's. */
export function applyColours(primaryWanted: unknown, accentWanted: unknown): void {
  const root = document.documentElement
  const { primary, accent } = brandColours({ brand: { primary: primaryWanted, accent: accentWanted } } as unknown as Me)
  const set = (name: string, value: string) => root.style.setProperty(name, value)
  set('--primary', primary)
  set('--primary-foreground', readableOn(primary))
  set('--brand-primary', primary)
  set('--sidebar-primary', primary)
  set('--sidebar-primary-foreground', readableOn(primary))
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

/**
 * The school a sign-in screen is for, from the code at the front of the ID
 * being typed (DEMO-8A-1 → DEMO) or from a link's ?school=DEMO: its name,
 * colours and logo (lms.school_brand), worn by the screen as soon as found.
 */
export function useSignInSchool(loginId: string): SchoolPublicBrand | null {
  const fromLink = typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('school') ?? '')
  const code = (loginId.trim().split('-')[0] || fromLink).toUpperCase()
  const [asked, setAsked] = useState(code)
  useEffect(() => {
    const t = setTimeout(() => setAsked(code), 350)
    return () => clearTimeout(t)
  }, [code])
  const school = useQuery({
    queryKey: ['school-brand', asked],
    queryFn: () => backend.schoolBrand(asked),
    enabled: /^[A-Z0-9]{3,12}$/.test(asked),
    staleTime: 10 * 60_000,
  })
  const found = school.data ?? null
  useEffect(() => {
    applyColours(found?.primary, found?.accent)
  }, [found?.primary, found?.accent])
  return found
}
