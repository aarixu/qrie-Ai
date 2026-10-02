import { type SVGProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Qrie's mark on its amber tile, as content/icon.svg draws it: two crossed
 * blue orbits, an ink nucleus and one electron, in the same 32-unit geometry
 * as apps/classroom/src/ui/Logo.tsx. Shown before anybody signs in, when no
 * school's logo is known yet.
 */
export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg' className={cn('size-8', className)} aria-hidden {...props}>
      <rect width='512' height='512' rx='112' fill='#FFC85C' />
      <rect x='6' y='6' width='500' height='500' rx='106' fill='none' stroke='#17171D' strokeWidth='12' />
      <g transform='translate(256 256) scale(13.5)'>
        <g fill='none' strokeWidth='2.4' stroke='#0B5FD9'>
          <ellipse rx='14' ry='6.2' transform='rotate(45)' />
          <ellipse rx='14' ry='6.2' transform='rotate(-45)' />
        </g>
        <circle r='4' fill='#17171D' />
        <circle cx='9.9' cy='-9.9' r='2.2' fill='#0B5FD9' stroke='#17171D' strokeWidth='1.2' />
      </g>
    </svg>
  )
}
