/**
 * HOW LONG A CHILD SPENT ON A PIECE OF HOMEWORK, sent with the hand-in as its
 * time on task for the brain's metric, unassisted gain per learning minute
 * (lam-one-brain Task 14, migration 0114). Counted only while the work is on
 * screen with the app in front: the caller pauses it when the page is hidden
 * (phone locked, another app) and resumes it when the page is shown. The
 * screen keeps the count on the phone beside the answers (`keepTimeOnTask`),
 * so a reload or a killed app carries on from what was kept rather than from
 * nothing. Time since the last keep can still be lost, so it can come out
 * short, never long. The school caps what it is sent (three hours, and the
 * time since the work was published) and times a test by its own clock
 * instead.
 */
export function createTimeOnTask(now: () => number = Date.now, visible = true, already = 0) {
  let counted = already
  let since: number | null = visible ? now() : null
  return {
    pause() {
      if (since === null) return
      counted += now() - since
      since = null
    },
    resume() {
      if (since === null) since = now()
    },
    /** Milliseconds on screen so far. */
    spent(): number {
      return counted + (since === null ? 0 : now() - since)
    },
  }
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const timeKey = (id: string) => `qrie-time-on-task-${id}`

function store(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The count kept on this phone for this work, or null when none is kept. */
export function keptTimeOnTask(id: string, s: Store | null = store()): number | null {
  try {
    const raw = s?.getItem(timeKey(id))
    if (raw == null) return null
    const v = Number(raw)
    return Number.isFinite(v) && v >= 0 ? v : null
  } catch {
    return null
  }
}

/** Keep the count on this phone (null forgets it, as on a hand-in). */
export function keepTimeOnTask(id: string, ms: number | null, s: Store | null = store()): void {
  try {
    if (ms === null) s?.removeItem(timeKey(id))
    else s?.setItem(timeKey(id), String(Math.round(ms)))
  } catch {
    /* this phone keeps nothing; the count lives only on screen */
  }
}

/**
 * Where the count starts when the work's screen opens. With answers kept
 * from before (a reload, a killed app) it carries on from the count kept with
 * them. With answers kept and no count (an older build kept them, or this
 * phone would not keep the count) the time before is unknown, and a count
 * from now would be short and overstate the gain per minute, so the hand-in
 * sends no time at all (`timed: false`): the brain then keeps that sitting's
 * gain out of the ratio (0114).
 */
export function resumeTimeOnTask(
  id: string,
  answersKept: boolean,
  s: Store | null = store()
): { already: number; timed: boolean } {
  const kept = keptTimeOnTask(id, s)
  if (kept !== null) return { already: kept, timed: true }
  return { already: 0, timed: !answersKept }
}
