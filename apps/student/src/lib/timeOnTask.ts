/**
 * HOW LONG A CHILD SPENT ON A PIECE OF HOMEWORK, sent with the hand-in as its
 * time on task for the brain's metric, unassisted gain per learning minute
 * (lam-one-brain Task 14, migration 0114). Counted only while the work is on
 * screen with the app in front: the caller pauses it when the page is hidden
 * (phone locked, another app) and resumes it when the page is shown. Kept in
 * memory by the screen that made it, so leaving the screen or reloading
 * starts it again: it can come out short, never long. The school caps what it is sent (three hours, and the time since the
 * work was published) and times a test by its own clock instead.
 */
export function createTimeOnTask(now: () => number = Date.now, visible = true) {
  let counted = 0
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
