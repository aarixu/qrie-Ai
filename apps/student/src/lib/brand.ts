import type { Me } from '@ai-tutor/lms-client'

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

/** Black or white, whichever reads better on `hex` (WCAG relative luminance). */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000000' : '#ffffff'
}
