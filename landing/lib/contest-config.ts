/**
 * Whether the contest takes entries, as Qrie control's contest.entries_open
 * says through public.app_config, and what each refusal of
 * record_contest_signup means for the person at the form. The database
 * enforces both switches (migration 0062); this page only says so first.
 */
export type Entries = 'checking' | 'open' | 'closed' | 'unknown'

/** 'open' only for a boolean true; anything the page cannot read is 'unknown', never 'open'. */
export function entriesOpenFrom(raw: unknown): Exclude<Entries, 'checking'> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return 'unknown'
  const value = (raw as Record<string, unknown>)['contest.entries_open']
  if (value === true) return 'open'
  if (value === false) return 'closed'
  return 'unknown'
}

/**
 * The sentence for a refusal of record_contest_signup, by its errcode.
 * 53400 is the day's limit (contest.daily_limit), which lifts at midnight
 * India time; 55000 is contest.entries_open switched off. Anything else is
 * worth trying again.
 */
export function problemForCode(code: string | undefined): string {
  if (code === '53400') {
    return 'Entries are full for today. Please come back after midnight (India time); nothing was saved.'
  }
  if (code === '55000') return 'Entries are closed right now. Nothing was saved.'
  return 'We could not save that. Please try again in a moment.'
}
