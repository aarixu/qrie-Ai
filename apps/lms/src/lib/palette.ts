/**
 * The app's colours for things that are not the school's brand: one hue per
 * subject, so Mathematics looks the same on every screen, and a steady hue
 * for anything else named (a class, a person) taken from its name.
 */

export interface Hue {
  /** The hue itself, for icons, bars and borders. */
  solid: string
  /** A see-through wash of it, for backgrounds; reads in light and dark mode. */
  soft: string
}

const hue = (solid: string): Hue => ({ solid, soft: `${solid}1f` })

const HUES = [
  hue('#2563eb'), // blue
  hue('#059669'), // emerald
  hue('#7c3aed'), // violet
  hue('#ea580c'), // orange
  hue('#e11d48'), // rose
  hue('#0891b2'), // cyan
  hue('#d97706'), // amber
  hue('#4f46e5'), // indigo
  hue('#0d9488'), // teal
  hue('#c026d3'), // fuchsia
]

const SUBJECT_HUE: Record<string, number> = {
  mathematics: 0,
  maths: 0,
  math: 0,
  science: 1,
  biology: 1,
  english: 2,
  hindi: 3,
  sanskrit: 4,
  music: 4,
  'computer science': 5,
  computers: 5,
  computer: 5,
  'social science': 6,
  'social studies': 6,
  history: 6,
  physics: 7,
  chemistry: 8,
  geography: 8,
  economics: 9,
  art: 9,
}

function hash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

/** A steady hue for any name: the same name always gets the same one. */
export function hueFor(name: string): Hue {
  return HUES[hash(name.trim().toLowerCase()) % HUES.length]!
}

/** The subject's own hue, or a steady one for a subject not listed. */
export function subjectHue(subject: string): Hue {
  const i = SUBJECT_HUE[subject.trim().toLowerCase()]
  return i === undefined ? hueFor(subject) : HUES[i]!
}

/** Hues for a row of numbers (KPI tiles): different neighbours, same order every time. */
export const KPI_HUES = [HUES[0]!, HUES[1]!, HUES[6]!, HUES[2]!, HUES[4]!, HUES[5]!, HUES[3]!, HUES[7]!]
