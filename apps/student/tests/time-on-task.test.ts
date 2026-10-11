import { describe, expect, it } from 'vitest'
import { createTimeOnTask } from '../src/lib/timeOnTask'

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
