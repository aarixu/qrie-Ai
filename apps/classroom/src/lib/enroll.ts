import { relayFetch } from './relay';

/**
 * THE CLIENT FOR THE FRONT DOOR.
 *
 * packages/relay/src/enroll.ts is the contract — request shapes, status
 * codes, and the sentences it refuses in. This file does two things and
 * nothing else: it speaks that contract exactly, and it turns every refusal
 * into words a parent standing over a child's shoulder can act on.
 *
 * WHY THE WORDS MATTER MORE THAN USUAL HERE. This is the one screen where the
 * person reading is not a user of the app: they are a parent who has been
 * handed a phone at a school contest desk. "429" tells them the app is
 * broken; "too many codes have gone to this number — wait four minutes" tells
 * them what to do. Every refusal below answers the second question.
 *
 * WHAT THIS DOES NOT DO: decide where an enrolled student lands. The relay
 * returns `next` and this returns it verbatim. See ENROLLED_NEXT in the relay
 * — policy that lives in a browser is policy every stale build gets to keep.
 */

/**
 * A number in the one shape the relay stores, or null.
 *
 * REFUSES RATHER THAN GUESSES. isE164 in the relay takes any country code,
 * and a client that helpfully prefixed +91 onto anything ten digits long
 * would happily turn a landline or a typo into a number an SMS is billed to.
 * So: an explicit + is trusted after its spacing is stripped; a bare Indian
 * mobile (ten digits starting 6-9, optionally with a 0 or 91 in front) gets
 * +91; everything else comes back null and the screen asks again.
 */
export function toE164(typed: string): string | null {
  const raw = typed.replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  const digits = raw.replace(/^\+/, '');
  /**
   * BY LENGTH, NEVER BY PREFIX. Stripping a leading "91" from the digits
   * turned 9198765432 — an allocated ten-digit mobile whose first two digits
   * happen to be 9 and 1 — into eight digits, and told a parent their own
   * number was not a number, with the Continue button dead under it. The
   * length says which reading is possible; only then is the country code read.
   */
  const ten =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits.length === 12 && digits.startsWith('91')
          ? digits.slice(2)
          : null;
  if (ten !== null && /^[6-9]\d{9}$/.test(ten)) return `+91${ten}`;
  return null;
}

/** How long to wait, said the way a person says it. */
function waitWords(seconds: number): string {
  if (seconds <= 90) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** The relay writes its refusals as sentences; this is where they are read. */
async function saidBy(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } } | null;
    const said = body?.error?.message;
    return typeof said === 'string' && said.trim() !== '' ? said : null;
  } catch {
    return null;
  }
}

const retryAfter = (res: Response, fallback: number): number => {
  const header = Number(res.headers.get('retry-after'));
  return Number.isFinite(header) && header > 0 ? header : fallback;
};

// ------------------------------------------------------------- asking for a code --

export type OtpRefusal =
  /** The send gate: 3 per phone per 10 minutes, plus the daily lines. */
  | { kind: 'rate-limited'; retryAfterSeconds: number }
  /** The SMS vendor took it and could not deliver. */
  | { kind: 'send-failed' }
  /** The gate itself is unreachable and the relay failed closed. */
  | { kind: 'gate-down'; retryAfterSeconds: number }
  /** No verified caller — the browser has no session yet. */
  | { kind: 'not-signed-in' }
  /** This host has no OTP provider wired at all. */
  | { kind: 'unsupported' }
  /** We refused before sending: that is not a phone number we can be sure of. */
  | { kind: 'bad-phone' }
  | { kind: 'offline' }
  | { kind: 'unknown' };

export type OtpResult = { ok: true } | { ok: false; refusal: OtpRefusal; message: string };

/** What to say to a parent for each refusal. Never a status code. */
export function otpWords(refusal: OtpRefusal): string {
  switch (refusal.kind) {
    case 'rate-limited':
      return `That number has already been sent a few codes. Please wait ${waitWords(
        refusal.retryAfterSeconds,
      )} and ask again.`;
    case 'send-failed':
      return 'We could not get the message to that number. Check the number and try once more — if it keeps failing, try a different phone.';
    case 'gate-down':
      return `We cannot send a code this second. Please try again in ${waitWords(
        refusal.retryAfterSeconds,
      )}.`;
    case 'not-signed-in':
      return 'This device lost its connection to us. Reload the page and start again — nothing you have typed is lost.';
    /**
     * THIS IS WHAT THE DEPLOYED HOST ANSWERS TODAY, and it is the single most
     * important operational fact about this door. The Edge Function wires no
     * `otp` dependency at all — supabase/functions/relay/index.ts:189-191 says
     * so in capitals, deliberately, because the dev provider keeps codes in a
     * per-isolate Map and would tell a parent their correct code was wrong —
     * so handleEnrollOtp returns 501 before it reaches the gate
     * (packages/relay/src/enroll.ts:455). Both enrolment routes therefore
     * refuse on the live host until a vendor lands behind the OtpProvider
     * seam, which the relay's own docblock reduces to one line:
     * `otp: createMsg91Otp(env('MSG91_KEY'))`, the key set as a function
     * secret. Until then this sentence is the end of the D2C funnel, so it
     * names a person to tell rather than a thing to retry.
     */
    case 'unsupported':
      return 'Enrolment is not switched on here yet. Please tell the person who gave you this link.';
    case 'bad-phone':
      return 'That does not look like a mobile number. Please enter the ten digits of a phone that can receive an SMS.';
    case 'offline':
      return 'Your phone is not online. Check the connection and try again.';
    case 'unknown':
      return 'Something went wrong at our end. Please try again in a moment.';
  }
}

/**
 * THE RELAY'S OWN SENTENCE WINS WHERE IT WROTE ONE.
 *
 * Two of these statuses have more than one cause and the client cannot tell
 * them apart. A 429 on /api/enroll/otp is the send gate (3 a phone per ten
 * minutes) OR admitFree's rate window (gate.ts:199-202); a 503 is the kill
 * switch (handler.ts:307-320) OR the project's daily cap, whose own accurate
 * words are "Qrie has taught a lot of classes today. Please come back
 * tomorrow." Substituting our sentence for either asserts a cause we do not
 * know — and the relay's prose is already written for a parent, which is why
 * refuseEnrol has always preferred it.
 *
 * Ours stays as the fallback, because a refusal with no body must still say
 * something, and the wait-words are ours to compute either way.
 */
const refuseOtp = (refusal: OtpRefusal, said: string | null = null): OtpResult => ({
  ok: false,
  refusal,
  message: said ?? otpWords(refusal),
});

/**
 * POST /api/enroll/otp.
 *
 * The phone must already be E.164 — `toE164` is the screen's job, so the
 * screen can say "that is not a mobile number" before a round trip. A number
 * that is not one is refused here too rather than sent, because the relay
 * would only refuse it back, slower.
 */
export async function requestOtp(parentPhone: string): Promise<OtpResult> {
  const phone = toE164(parentPhone);
  if (phone === null) return refuseOtp({ kind: 'bad-phone' });

  let res: Response;
  try {
    res = await relayFetch('/api/enroll/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentPhone: phone }),
    });
  } catch {
    return refuseOtp({ kind: 'offline' });
  }

  if (res.ok) return { ok: true };

  const said = await saidBy(res);
  switch (res.status) {
    case 429:
      return refuseOtp({ kind: 'rate-limited', retryAfterSeconds: retryAfter(res, 600) }, said);
    case 503:
      return refuseOtp({ kind: 'gate-down', retryAfterSeconds: retryAfter(res, 5) }, said);
    case 502:
      return refuseOtp({ kind: 'send-failed' });
    case 401:
      return refuseOtp({ kind: 'not-signed-in' });
    case 501:
      return refuseOtp({ kind: 'unsupported' });
    case 400:
      return refuseOtp({ kind: 'bad-phone' });
    default:
      return refuseOtp({ kind: 'unknown' });
  }
}

// ------------------------------------------------------------------ enrolling --

/**
 * EXACTLY WHAT THE RELAY ACCEPTS, AND NOTHING MORE.
 *
 * `consent` is not here because the form does not carry it as data: it is an
 * affirmative act on the consent screen, and submitEnrolment sends the
 * literal true only when it is called. Every other field the marketing team
 * might want — an email, a second phone, an age — is a data-protection
 * liability with no use in MVP-1, and the relay would drop it anyway.
 */
export interface EnrolmentForm {
  studentName: string;
  klass: number;
  board: 'ncert';
  subjects: string[];
  schoolName?: string;
  city?: string;
  parentName: string;
  parentPhone: string;
  otp: string;
  contestCode?: string;
}

export type EnrolRefusal =
  /** The code was wrong or has expired. The relay's own words say which. */
  | { kind: 'bad-code' }
  /** Not the code: the phone never parsed, so nothing was sent anywhere. */
  | { kind: 'bad-phone' }
  /** The consent row could not be written, so there was no enrolment. */
  | { kind: 'not-recorded' }
  | { kind: 'not-signed-in' }
  | { kind: 'unsupported' }
  | { kind: 'too-many' }
  | { kind: 'offline' }
  | { kind: 'unknown' };

export type EnrolResult =
  | { ok: true; next: string }
  | { ok: false; refusal: EnrolRefusal; message: string };

export function enrolWords(refusal: EnrolRefusal): string {
  switch (refusal.kind) {
    case 'bad-code':
      return 'That code is not right, or it has expired. Ask for a new one and try again.';
    case 'bad-phone':
      return 'That does not look like a mobile number. Please go back and check the ten digits of a phone that can receive an SMS.';
    case 'not-recorded':
      return 'We could not save the enrolment, so nothing was recorded. Please ask for a new code and try once more.';
    case 'not-signed-in':
      return 'This device lost its connection to us. Reload the page and start again.';
    case 'unsupported':
      return 'Enrolment is not switched on here yet. Please tell the person who gave you this link.';
    case 'too-many':
      return 'That is a lot of tries in a short time. Please wait a few minutes and start again.';
    case 'offline':
      return 'Your phone is not online. Check the connection and try again.';
    case 'unknown':
      return 'Something went wrong at our end, and nothing was saved. Please try again in a moment.';
  }
}

const refuseEnrol = (refusal: EnrolRefusal, said: string | null = null): EnrolResult => ({
  ok: false,
  refusal,
  // The relay's sentence when it wrote one — it is already parent-readable,
  // and it is the only thing that can tell "wrong code" from "expired code".
  message: said ?? enrolWords(refusal),
});

/** Present, once trimmed. Absent fields are LEFT OUT rather than sent empty. */
const some = (v: string | undefined): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

/**
 * POST /api/enroll — the code is verified, the consent row is written, and
 * the server says where the student goes next.
 *
 * `next` COMES BACK VERBATIM. Never rebuild it: it is server-decided on
 * purpose, and a 200 that carries no `next` is treated as a failure rather
 * than quietly replaced with a guess — a student sent to the wrong place by
 * a client's imagination is worse than one told to try again.
 */
export async function submitEnrolment(form: EnrolmentForm): Promise<EnrolResult> {
  const phone = toE164(form.parentPhone);
  // Not 'bad-code'. A parent whose NUMBER could not be read, told to ask for
  // a new code, spends sends against a gate of three per phone per ten
  // minutes on a fault that is three screens behind them.
  if (phone === null) return refuseEnrol({ kind: 'bad-phone' });

  const body: Record<string, unknown> = {
    studentName: form.studentName.trim(),
    klass: form.klass,
    board: form.board,
    subjects: form.subjects,
    parentName: form.parentName.trim(),
    parentPhone: phone,
    // The LITERAL true, because DPDP consent is an affirmative act and the
    // relay refuses anything else. See readEnrollRequest in enroll.ts.
    consent: true,
    otp: form.otp.trim(),
  };
  const schoolName = some(form.schoolName);
  if (schoolName !== undefined) body.schoolName = schoolName;
  const city = some(form.city);
  if (city !== undefined) body.city = city;
  const contestCode = some(form.contestCode);
  if (contestCode !== undefined) body.contestCode = contestCode;

  let res: Response;
  try {
    res = await relayFetch('/api/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return refuseEnrol({ kind: 'offline' });
  }

  if (res.ok) {
    const answer = (await res.json().catch(() => null)) as { next?: unknown } | null;
    if (typeof answer?.next === 'string' && answer.next !== '') {
      return { ok: true, next: answer.next };
    }
    return refuseEnrol({ kind: 'unknown' });
  }

  const said = await saidBy(res);
  switch (res.status) {
    case 400:
      /**
       * The relay answers 400 for a wrong code AND for a field it will not
       * accept, in different sentences. The screen validates every field
       * before it gets here, so in practice this is the code — and the
       * message shown is the relay's own sentence either way, which is
       * correct for both. Classifying on the prose would be worse: it would
       * break the first time somebody rewords a string.
       */
      return refuseEnrol({ kind: 'bad-code' }, said);
    case 503:
      return refuseEnrol({ kind: 'not-recorded' }, said);
    case 401:
      return refuseEnrol({ kind: 'not-signed-in' });
    case 501:
      return refuseEnrol({ kind: 'unsupported' });
    case 429:
      return refuseEnrol({ kind: 'too-many' });
    default:
      return refuseEnrol({ kind: 'unknown' });
  }
}
