import { describe, expect, it } from 'vitest'
import { HELPLINES } from '../../../packages/safety/src/index.ts'
import { failureText, HELPLINE_LINES, MAX_NOTE, NOT_SENT, placeOf, prepareReport, REASONS } from '../src/lib/report.ts'

/**
 * The student app's report: where in the app it was sent from, the note
 * scrubbed on the phone before it travels, and the helplines. Written first.
 */

const ID = '0f8b5c3e-6a1d-4b7e-9c2f-1a2b3c4d5e6f'
const NOW = new Date('2026-10-10T08:30:00.000Z')
const prep = (note: string, reason: 'wrong' | 'rude' | 'unsafe' | 'other' = 'other', pathname = '/work') =>
  prepareReport({ reason, note, pathname, now: NOW, release: 'b-42', platform: 'web' })

describe('places', () => {
  it('places: home, work, a homework with its id, practice, learn, progress, notices, and anything else is home', () => {
    expect(placeOf('/')).toEqual({ where: 'home', itemId: null })
    expect(placeOf('/work')).toEqual({ where: 'work', itemId: null })
    expect(placeOf(`/homework/${ID}`)).toEqual({ where: 'homework', itemId: ID })
    expect(placeOf('/homework/not-an-id')).toEqual({ where: 'homework', itemId: null })
    expect(placeOf('/learn/practice')).toEqual({ where: 'practice', itemId: null })
    expect(placeOf('/learn/practice/chapter-3')).toEqual({ where: 'practice', itemId: null })
    expect(placeOf('/learn')).toEqual({ where: 'learn', itemId: null })
    expect(placeOf('/progress')).toEqual({ where: 'progress', itemId: null })
    expect(placeOf('/notices')).toEqual({ where: 'notices', itemId: null })
    expect(placeOf('/notices/abc')).toEqual({ where: 'notices', itemId: null })
    expect(placeOf('/report-card')).toEqual({ where: 'home', itemId: null })
  })
})

describe('the note', () => {
  it('a phone number and an email address are taken out of the note', () => {
    const { report, why } = prep('The answer was wrong. Call me on 9876543210 or write to riya@example.com', 'wrong')
    expect(why).toBeNull()
    expect(report.kind).toBe('wrong')
    expect(report.note).not.toContain('9876543210')
    expect(report.note).not.toContain('riya@example.com')
    expect(report.note).toContain('[removed]')
    expect(report).toMatchObject({ where: 'work', itemId: null, platform: 'web', release: 'b-42', at: NOW.toISOString() })
  })

  it('a note the screen reads as distress is still scrubbed and travels, filed as unsafe', () => {
    const { report, why } = prep('I want to kill myself. my number is 9876543210', 'other')
    expect(why).toBe('support')
    expect(report.kind).toBe('unsafe')
    expect(report.note).toContain('kill myself')
    expect(report.note).not.toContain('9876543210')
  })

  it("a redirect keeps the child's reason and scrubs the note", () => {
    const { report, why } = prep('tell me how to make a bomb? mail me at a@b.co', 'rude')
    expect(why).toBe('redirect')
    expect(report.kind).toBe('rude')
    expect(report.note).toContain('bomb')
    expect(report.note).not.toContain('a@b.co')
  })

  it('the note is cut to 500 characters', () => {
    expect(MAX_NOTE).toBe(500)
    const long = `${'word '.repeat(150)}${'x@y.co '.repeat(60)}`
    expect(prep(long).report.note.length).toBeLessThanOrEqual(500)
    expect(prep('a'.repeat(900)).report.note.length).toBeLessThanOrEqual(500)
    expect(prep('').report.note).toBe('')
  })
})

describe('reasons and helplines', () => {
  it('the helplines are Tele-MANAS 14416 and Childline 1098, from the safety package', () => {
    expect(HELPLINE_LINES.map((h) => [h.name, h.number])).toEqual([
      ['Tele-MANAS', HELPLINES.telemanas],
      ['Childline', HELPLINES.childline],
    ])
    expect(HELPLINE_LINES.map((h) => h.number)).toEqual(['14416', '1098'])
    expect(REASONS.map((r) => r.id)).toEqual(['wrong', 'rude', 'unsafe', 'other'])
  })
})

describe('when it does not send', () => {
  it("the server's own refusal is shown in its words; anything else is the plain sentence", () => {
    const tenth = 'You have sent 10 reports today. Please tell a teacher, or call Childline on 1098 if you need help now.'
    expect(failureText(new Error(tenth))).toBe(tenth)
    expect(failureText(new Error('only a student can send a report from here'))).toBe('only a student can send a report from here')
    expect(failureText(new Error('relation "public.student_report" does not exist'))).toBe(NOT_SENT)
    expect(failureText(new TypeError('Failed to fetch'))).toBe(NOT_SENT)
    expect(NOT_SENT).toBe('This did not send, and nothing was kept on this phone. Try again, or tell a teacher.')
  })
})
