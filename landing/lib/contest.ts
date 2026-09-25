import { accessToken, supabase } from './supabase'

/**
 * The contest entry, from what a child typed to what the database fences.
 *
 * Kept out of the component because these are the rules, not the rendering:
 * the column CHECKs in migration 0020 are the fence that actually holds, and
 * everything here exists so a person at a form is told which field is wrong
 * instead of being handed a Postgres constraint name.
 */

export interface Entry {
  studentName: string
  parentName: string
  studentMobile: string
  parentMobile: string
  klass: string
  address: string
  takesTuition: string
}

/**
 * Ten digits as typed into an Indian form, to the one canonical E.164 shape.
 *
 * Two spellings of one number are two entrants to everybody counting, which is
 * why `consent_record` and `contest_signup` both fence the same single shape.
 * `+91` is assumed because the form's own input pattern is [0-9]{10}; anything
 * that is not exactly that is refused rather than guessed at, since this is a
 * number somebody will later be asked to ring about a prize.
 */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
    return `+${digits}`
  }
  return null
}

/** The class as an integer, refusing anything this product does not teach. */
export function toKlass(raw: string): number | null {
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n >= 6 && n <= 12 ? n : null
}

const trimmed = (raw: string, max: number): string | null => {
  const s = raw.trim()
  return s.length > 0 && s.length <= max ? s : null
}

export type Saved =
  | { ok: true }
  /** Something the person can fix, named so they can fix it. */
  | { ok: false; problem: string }

/**
 * Write the entry, as the visitor's own anonymous identity.
 *
 * There is no server route here on purpose. `record_contest_signup` is a
 * `security definer` function that reads `auth.uid()` out of the caller's own
 * JWT, so the row can only ever be theirs — no user id crosses the wire to be
 * tampered with, and this site holds no key that could write anybody else's.
 */
export async function saveEntry(entry: Entry): Promise<Saved> {
  const db = supabase()
  if (!db) {
    // The deploy is wrong, not the person. Saying so is how an empty contest
    // table gets noticed before the contest runs rather than after.
    return { ok: false, problem: 'Registration is not switched on yet. Nothing was saved.' }
  }

  const studentName = trimmed(entry.studentName, 80)
  const parentName = trimmed(entry.parentName, 80)
  const address = trimmed(entry.address, 300)
  const klass = toKlass(entry.klass)
  const studentPhone = toE164(entry.studentMobile)
  const parentPhone = toE164(entry.parentMobile)

  if (!studentName) return { ok: false, problem: 'Please check the student name.' }
  if (klass === null) return { ok: false, problem: 'Please pick a class between 6 and 12.' }
  if (!studentPhone) return { ok: false, problem: 'Please check the student mobile number — 10 digits.' }
  if (!parentName) return { ok: false, problem: 'Please check the parent or guardian name.' }
  if (!parentPhone) return { ok: false, problem: 'Please check the parent mobile number — 10 digits.' }
  if (!address) return { ok: false, problem: 'Please check the address.' }

  // Minted here rather than left to the rpc call: the function refuses without
  // a session, and a first-time visitor has none until this asks for one.
  const token = await accessToken()
  if (!token) return { ok: false, problem: 'We could not start your session. Nothing was saved.' }

  const { error } = await db.rpc('record_contest_signup', {
    p_student_name: studentName,
    p_klass: klass,
    p_student_phone: studentPhone,
    p_address: address,
    p_takes_tuition: entry.takesTuition === 'yes' ? true : entry.takesTuition === 'no' ? false : null,
    p_parent_name: parentName,
    p_parent_phone: parentPhone,
    p_campaign: 'champion-league',
  })

  if (error) {
    // The message is ours, not Postgres's — a constraint name helps nobody on a
    // phone — but the real one is logged so a broken deploy is diagnosable.
    console.error('[curie] contest signup failed:', error.code, error.message)
    // 53400 is the project-wide daily cap in record_contest_signup, and it is
    // the one failure where "try again in a moment" would be a lie: the cap
    // does not lift until midnight UTC. Everything else is worth retrying.
    if (error.code === '53400') {
      return {
        ok: false,
        problem: 'Entries are full for today. Please come back tomorrow — nothing was saved.',
      }
    }
    return { ok: false, problem: 'We could not save that. Please try again in a moment.' }
  }
  return { ok: true }
}
