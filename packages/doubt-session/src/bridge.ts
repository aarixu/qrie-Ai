import type { DoubtContext, DoubtLanguage } from './context';

/**
 * The bridging lines — the two sentences that stitch the recording and the
 * live agent into what feels like one continuous class. Entry acknowledges
 * the pause and names the topic the student just raised a hand on; exit hands
 * back to the recording as if the same teacher simply carried on.
 *
 * A few variants each so the seam doesn't sound canned over a whole lesson.
 * The choice is a pure hash of beatId: the same moment always gets the same
 * line, which is what lets tests assert the seam exactly.
 *
 * IN THE CHILD'S LANGUAGE (overnight review #27): `ctx.lang` is the tutor
 * language they chose at onboarding. 'hi-en' is Hinglish in Roman script, as
 * a Class 6-10 student would text it, and Meera's verbs are feminine. Absent
 * is English, as before. How natural the Hinglish reads is UNVERIFIED until
 * somebody who speaks it has listened.
 */

/** Small stable string hash. Not crypto — just deterministic variant spread. */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

const pick = <T>(variants: readonly T[], seed: string): T =>
  variants[hashOf(seed) % variants.length];

type ByLanguage<T> = Record<DoubtLanguage, readonly T[]>;

const ENTRY: ByLanguage<(topic: string) => string> = {
  en: [
    (t) =>
      `Yes, go ahead — good place to stop, actually. We were right in the middle of '${t}'. What's your doubt?`,
    (t) =>
      `One second, I've paused the class. We were just looking at '${t}' — tell me, where did you get stuck?`,
    (t) =>
      `Take your time, no hurry at all. '${t}' can feel a little tricky — ask me, what didn't make sense?`,
    (t) =>
      `Yes yes, ask away — that's exactly what I'm here for. We were on '${t}' — what would you like to know?`,
  ],
  'hi-en': [
    (t) => `Haan, bolo — achhi jagah pe roka. Hum '${t}' ke beech mein the. Kya doubt hai?`,
    (t) => `Ek second, maine class pause kar di hai. Hum '${t}' dekh rahe the — batao, kahan dikkat hui?`,
    (t) => `Aaram se, koi jaldi nahi. '${t}' thoda tricky lag sakta hai — pucho, kya samajh nahi aaya?`,
    (t) => `Haan haan, pucho — main isi liye toh hoon. Hum '${t}' pe the — kya jaanna hai?`,
  ],
};

const EXIT: ByLanguage<string> = {
  en: [
    `All clear? Good. Let's pick the class back up right where we left it.`,
    `Makes sense now? Great. Let's continue from exactly where we stopped.`,
    `Alright, that doubt is sorted. Back to the lesson — same spot we paused at.`,
    `And if anything else comes up, just raise your hand again — I'm right here. Let's move on.`,
  ],
  'hi-en': [
    `Clear hua? Badhiya. Chalo, class wahi se aage badhaate hain jahan roki thi.`,
    `Ab samajh aaya? Great. Chalo, bilkul wahi se continue karte hain.`,
    `Theek hai, yeh doubt clear ho gaya. Chalo wapas lesson pe — usi jagah se.`,
    `Aur kuch bhi aaye toh phir se haath utha dena — main yahin hoon. Chalo aage.`,
  ],
};

/**
 * The way out when a doubt reaches the turn cap (handoff.ts), said INSTEAD of
 * an exit line rather than before one. It does not claim the doubt is solved —
 * the cap knows how many turns were taken, not whether any of them landed — so
 * it offers the lesson as the next thing to try and the raised hand as still
 * open.
 */
const CLOSING: ByLanguage<string> = {
  en: [
    `We have talked this one through properly now. Let's go back to the class — it often clicks once you see the next part. Raise your hand again any time.`,
    `That was a good long look at it. Let's carry on with the class from where we paused, and if it still feels unclear, raise your hand again.`,
  ],
  'hi-en': [
    `Humne isko achhe se discuss kar liya. Chalo class pe wapas chalte hain — aage ka part dekh ke aksar click ho jaata hai. Kabhi bhi phir haath utha dena.`,
    `Kaafi achhe se dekha humne. Chalo class wahi se continue karte hain, aur agar ab bhi unclear lage toh phir se haath uthana.`,
  ],
};

const langOf = (ctx: DoubtContext): DoubtLanguage => (ctx.lang === 'hi-en' ? 'hi-en' : 'en');

export function entryLine(ctx: DoubtContext): string {
  return pick(ENTRY[langOf(ctx)], ctx.beatId)(ctx.beatTopic);
}

export function exitLine(ctx: DoubtContext): string {
  return pick(EXIT[langOf(ctx)], ctx.beatId);
}

export function closingLine(ctx: DoubtContext): string {
  return pick(CLOSING[langOf(ctx)], ctx.beatId);
}
