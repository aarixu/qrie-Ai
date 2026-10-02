import {
  Atom,
  BookOpen,
  Calculator,
  Dna,
  FlaskConical,
  Globe2,
  Landmark,
  Languages,
  Leaf,
  Monitor,
  Music,
  Palette,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { subjectHue } from '@/lib/palette'

const ICONS: [RegExp, LucideIcon][] = [
  [/math/i, Calculator],
  [/physics/i, Atom],
  [/chemistry/i, FlaskConical],
  [/biology/i, Dna],
  [/science/i, Leaf],
  [/english|literature/i, BookOpen],
  [/hindi|sanskrit|urdu|tamil|bengali|marathi|language/i, Languages],
  [/history|civics|political/i, Landmark],
  [/social|geography|economics/i, Globe2],
  [/computer|coding|it\b/i, Monitor],
  [/music/i, Music],
  [/art|drawing/i, Palette],
]

export function iconFor(subject: string): LucideIcon {
  return ICONS.find(([re]) => re.test(subject))?.[1] ?? BookOpen
}

/** A subject's icon on a wash of its own colour. */
export function SubjectBadge({ subject, className }: { subject: string; className?: string }) {
  const Icon = iconFor(subject)
  const h = subjectHue(subject)
  return (
    <span
      className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-lg', className)}
      style={{ background: h.soft, color: h.solid }}
      aria-hidden
    >
      <Icon className='size-[55%]' />
    </span>
  )
}
