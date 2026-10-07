import { describe, expect, it } from 'vitest'
import type { PracticeForMe, PracticeReason } from '@ai-tutor/lms-client'
import { pickedForYou } from '../src/features/learn/picked'

/**
 * The words on the "Picked for you" card (home and Learn): what the
 * practice round lms.practice_for_me (0064) picked from the child's own
 * answers, in a child's words. A due review is named first, then the outcome
 * to practise, with the wrong idea to watch out for; the child never reads
 * "misconception" or "confirmed" (review SF10).
 */

let n = 0
const row = (reason: PracticeReason, outcomeTitle: string, watchOut: string | null = null): PracticeForMe => ({
  itemId: `item-${++n}`,
  stem: 'Which is a rational number?',
  options: ['a', 'b', 'c'],
  subject: 'Mathematics',
  chapter: 'rational-numbers',
  outcomeId: `outcome-${outcomeTitle}`,
  outcomeTitle,
  reason,
  watchOut,
})

describe('the Picked for you lines', () => {
  it('names a due review first, then what to practise and the wrong idea to watch out for', () => {
    const lines = pickedForYou([
      row('misconception', 'Define a rational number', 'thinks the denominator may be zero'),
      row('misconception', 'Define a rational number', 'thinks the denominator may be zero'),
      row('review', 'Closure under addition'),
      row('weak', 'Additive inverse'),
    ])
    expect(lines).toEqual([
      'Review due: Closure under addition',
      'Practise this: Define a rational number, watch out for: thinks the denominator may be zero',
    ])
  })

  it('a weak outcome with no wrong idea to name is just "Practise this"', () => {
    expect(pickedForYou([row('weak', 'Additive inverse'), row('new', 'Closure under addition')])).toEqual([
      'Practise this: Additive inverse',
    ])
  })

  it('a review alone is a review', () => {
    expect(pickedForYou([row('review', 'Closure under addition'), row('more', 'Additive inverse')])).toEqual([
      'Review due: Closure under addition',
    ])
  })

  it('says nothing when the evidence picked nothing: only new questions, or questions they are strong on', () => {
    expect(pickedForYou([])).toEqual([])
    expect(pickedForYou([row('new', 'Closure under addition'), row('more', 'Additive inverse')])).toEqual([])
  })

  it('never says misconception or confirmed', () => {
    const lines = pickedForYou([row('misconception', 'Define a rational number', 'adds the tops and the bottoms'), row('review', 'Closure')])
    for (const line of lines) expect(line).not.toMatch(/misconception|confirmed/i)
  })
})
