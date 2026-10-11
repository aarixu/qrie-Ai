import { describe, expect, it } from 'vitest'
import { createTimeOnTask, keepTimeOnTask, keptTimeOnTask, resumeTimeOnTask } from '../src/lib/timeOnTask'

/**
 * The time a child spent on homework, sent with the hand-in for the brain's
 * metric (lam-one-brain Task 14, 0114): time with the work on screen and the
 * app in front, never time with the phone locked or another app open.
 */

function clock(start = 1_000) {
  let t = start
  return { now: () => t, tick: (ms: number) => void (t += ms) }
}

describe('time on task', () => {
  it('counts the time the work is on screen', () => {
    const c = clock()
    const time = createTimeOnTask(c.now)
    c.tick(90_000)
    expect(time.spent()).toBe(90_000)
  })

  it('does not count time with the app in the background', () => {
    const c = clock()
    const time = createTimeOnTask(c.now)
    c.tick(60_000)
    time.pause()
    c.tick(10 * 60_000)
    time.resume()
    c.tick(30_000)
    expect(time.spent()).toBe(90_000)
  })

  it('starts paused when the app opens in the background, and a second pause or resume changes nothing', () => {
    const c = clock()
    const time = createTimeOnTask(c.now, false)
    c.tick(60_000)
    time.pause()
    time.resume()
    c.tick(20_000)
    time.resume()
    c.tick(20_000)
    time.pause()
    time.pause()
    c.tick(60_000)
    expect(time.spent()).toBe(40_000)
  })
})

/** A phone's storage, in memory. */
function phone() {
  const kept = new Map<string, string>()
  return {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  }
}

describe('time on task across a reload (P2 review)', () => {
  it('a reload carries on from the count kept with the answers, not from nothing', () => {
    const s = phone()
    const c = clock()
    const first = createTimeOnTask(c.now)
    c.tick(12 * 60_000)
    keepTimeOnTask('hw1', first.spent(), s)
    // The app is killed; the screen opens again with the answers restored.
    const start = resumeTimeOnTask('hw1', true, s)
    expect(start).toEqual({ already: 12 * 60_000, timed: true })
    const again = createTimeOnTask(c.now, true, start.already)
    c.tick(5_000)
    expect(again.spent()).toBe(12 * 60_000 + 5_000)
  })

  it('answers restored with no count kept send no time, rather than a few seconds', () => {
    const s = phone()
    expect(resumeTimeOnTask('hw2', true, s)).toEqual({ already: 0, timed: false })
  })

  it('a fresh start, with nothing kept, is timed from zero', () => {
    expect(resumeTimeOnTask('hw3', false, phone())).toEqual({ already: 0, timed: true })
  })

  it('a hand-in forgets the count, and a phone that keeps nothing still counts on screen', () => {
    const s = phone()
    keepTimeOnTask('hw4', 90_000, s)
    expect(keptTimeOnTask('hw4', s)).toBe(90_000)
    keepTimeOnTask('hw4', null, s)
    expect(keptTimeOnTask('hw4', s)).toBeNull()
    const refusing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
    expect(() => keepTimeOnTask('hw5', 1_000, refusing)).not.toThrow()
    expect(keptTimeOnTask('hw5', refusing)).toBeNull()
    expect(resumeTimeOnTask('hw5', false, refusing)).toEqual({ already: 0, timed: true })
  })

  it('reads nothing odd as a count', () => {
    const s = phone()
    s.setItem('qrie-time-on-task-hw6', 'not a number')
    expect(keptTimeOnTask('hw6', s)).toBeNull()
    s.setItem('qrie-time-on-task-hw6', '-5')
    expect(keptTimeOnTask('hw6', s)).toBeNull()
  })
})
