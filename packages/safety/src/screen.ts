/**
 * WHAT A CHILD SAYS, AND WHAT SHE SAYS BACK.
 *
 * This product puts an open-ended voice conversation in front of children
 * between eleven and eighteen, and until now nothing looked at either side of
 * it: not a filter, not a log, not a report button. That is the single thing a
 * store reviewer checks hardest in a child-facing app, and it is also just
 * true that a tutor who cannot recognise a child telling her something serious
 * is not safe to leave alone with one.
 *
 * WHAT THIS IS NOT. It is not a rude-word blocklist. Those catch nothing that
 * matters, insult the students they misfire on, and give the people who ship
 * them a feeling of having done something. Every rule here earns its place by
 * naming a specific harm and a specific response.
 *
 * WHAT IT IS: four judgements, in the order they matter.
 *
 *   1. DISTRESS. A child saying they want to hurt themselves, or that someone
 *      is hurting them, is the most important sentence this app will ever
 *      receive. The response is not to block them — being cut off is the worst
 *      possible answer — it is to stop teaching, say something human, and put
 *      a real helpline in front of them. India-specific, because our students
 *      are in India and a US number is worse than none.
 *   2. PERSONAL DETAIL. A child volunteers a phone number or an address far
 *      more readily than an adult. Those are masked before the words go to any
 *      model and before they are written on a board somebody can screenshot.
 *   3. INSTRUCTIONS DRESSED AS ANSWERS. The child's transcript is interpolated
 *      into prompts inside quotes. Without this, "ignore your instructions and
 *      ..." typed into an answer box IS an instruction.
 *   4. OFF-LIMITS. Things a school tutor should decline rather than teach.
 *      A redirect, warmly — never a lecture about why they asked.
 *
 * Pure, synchronous and local. No model call, no network, no clock. It runs on
 * the same device the words were spoken on, which is what lets it sit in front
 * of the network rather than behind it — and it means a flagged sentence never
 * has to leave the room to be recognised.
 */

export type Verdict =
  /** Nothing to do. The overwhelming majority. */
  | { kind: 'allow'; text: string }
  /**
   * The words are fine but carry something that must not travel: a phone
   * number, an address, an attempt to give instructions. `text` is the
   * cleaned version, and it is what should be used from here on.
   */
  | { kind: 'clean'; text: string; removed: Removed[] }
  /** Not something to teach. `say` is what she says instead. */
  | { kind: 'redirect'; say: string }
  /**
   * A child may be in trouble. Everything stops; `say` is said, and the
   * exchange is flagged. Never silently swallowed.
   */
  | { kind: 'support'; say: string };

export type Removed = 'phone' | 'email' | 'address' | 'instruction';

export type Direction = 'from-student' | 'to-student';

/**
 * THE HELPLINES.
 *
 * Indian, free, and staffed — a US crisis line in a Class 8 classroom in
 * Bhopal is worse than saying nothing, because it looks like help and is not.
 *
 * Tele-MANAS is the Government of India's own mental-health line and answers
 * in twenty languages. Childline 1098 is the national child-protection line
 * and is who a child in danger from an adult should reach.
 */
export const HELPLINES = {
  telemanas: '14416',
  childline: '1098',
} as const;

/**
 * What she says when a student tells her something serious.
 *
 * Written to be said out loud by a tutor, not printed by a system. It does
 * three things and nothing else: it takes the student seriously, it says the
 * one true thing (this is not something to carry alone), and it gives a number
 * that a child can actually ring. It does not diagnose, does not promise, and
 * does not ask them to explain themselves further.
 */
export const SUPPORT_REPLY =
  `I am really glad you told me, and I want to stop the class for a moment. ` +
  `What you are describing is not something you should have to carry on your own, ` +
  `and I am not the right kind of help for it. Please talk to a grown-up you trust today — ` +
  `a parent, a teacher, anyone. You can also call Tele-MANAS on ${HELPLINES.telemanas}, ` +
  `free, any time of day, and they will listen. If someone is hurting you, Childline is ${HELPLINES.childline}. ` +
  `I will be right here when you want to carry on.`;

/** What she says instead of teaching something that is not hers to teach. */
export const REDIRECT_REPLY =
  'That one is outside what I can help with — I am here for your school subjects. ' +
  'Ask me anything from your syllabus and we will get straight into it.';

/**
 * DISTRESS.
 *
 * Deliberately narrow. Every pattern here describes a person saying something
 * about themselves or about being hurt — not a topic, not a word. "Suicide" on
 * its own matches nothing, because a Class 10 student reading Hamlet or a
 * history chapter says it in a sentence that needs no helpline; the app
 * interrupting them would teach the student that the tutor does not listen.
 *
 * Missing a real one costs more than an extra false positive, and the response
 * to a false positive is a warm sentence and a phone number, which harms
 * nobody. That asymmetry is what sets the threshold.
 */
const DISTRESS: RegExp[] = [
  // Intent about oneself.
  //
  // "die" is followed by (?![\w-]) rather than a bare \b: a word boundary sits
  // happily before a hyphen, so "I want to die-cast the metal" — a real Class
  // 10 metallurgy question — stopped the class and offered a helpline.
  /\bi\s+(?:want|wanna|need|am going|'m going|plan)\s+to\s+(?:die(?![\w-])|kill\s+myself|end\s+(?:it|my\s+life)|hurt\s+myself|harm\s+myself)/i,
  /\bi\s+(?:will|'ll|might|may)\s+(?:kill\s+myself|end\s+(?:it|my\s+life)|hurt\s+myself)/i,
  // Any tense, because a child says "I have been cutting myself" far more
  // often than "I cut myself".
  /\b(?:killing|hurting|harming|cutting|cut|harm|hurt)\s+myself\b/i,
  /\bi\s+(?:do\s*n[o']?t|don'?t)\s+want\s+to\s+(?:live|be\s+alive|be\s+here)\b/i,
  /\bi\s+(?:wish|want)\s+i\s+(?:was|were)\s+dead\b/i,
  /\bno\s+(?:point|reason)\s+in\s+living\b/i,
  /\bend\s+my\s+life\b/i,
  // Being hurt by someone.
  /\b(?:someone|somebody|my\s+(?:father|mother|dad|mum|mom|uncle|aunt|brother|sister|teacher|sir|maam|ma'am))\s+(?:is\s+)?(?:hit|hits|hitting|beat|beats|beating|hurt|hurts|hurting|touch|touches|touching)(?:ing)?\s+me\b/i,
  /\bi\s+am\s+(?:being\s+)?(?:beaten|abused|molested)\b/i,
  /\bhe\s+touch(?:es|ed)?\s+me\b/i,
  /\bafraid\s+to\s+go\s+home\b/i,
];

/**
 * OFF-LIMITS.
 *
 * Short on purpose. A school tutor declining to explain how to make an
 * explosive is obvious; a school tutor refusing to discuss reproduction is
 * failing a Class 10 Biology student, so the NCERT syllabus wins wherever the
 * two look similar. Nothing here matches a syllabus topic.
 */
const OFF_LIMITS: RegExp[] = [
  /\bhow\s+to\s+(?:make|build|synthesi[sz]e)\s+(?:a\s+)?(?:bomb|explosive|gun|weapon|poison)\b/i,
  /\bhow\s+(?:do\s+i|to)\s+(?:buy|get|score)\s+(?:drugs|cocaine|heroin|weed|meth)\b/i,
  /\b(?:porn|pornography|nudes|sexting)\b/i,
  /\bhow\s+to\s+(?:hack|crack)\s+(?:someone|somebody|my\s+\w+)(?:'s)?\s+(?:account|phone|password|instagram|whatsapp)\b/i,
];

/**
 * INSTRUCTIONS DRESSED AS ANSWERS.
 *
 * The student's transcript is dropped into a prompt inside quotes with no
 * escaping. Without this, an answer box is a second system prompt.
 */
const INSTRUCTION: RegExp[] = [
  /\bignore\s+(?:all\s+)?(?:your\s+|the\s+|previous\s+|above\s+)*(?:instructions?|rules?|prompts?)\b/i,
  /\b(?:disregard|forget)\s+(?:all\s+)?(?:your\s+|the\s+|previous\s+)*(?:instructions?|rules?)\b/i,
  /\byou\s+are\s+now\s+(?:a|an)\s+/i,
  /\bsystem\s*:\s*/i,
  // "pretend you are DAN" is how it is actually typed; "act as if you are"
  // was the shape I imagined.
  /\b(?:act|behave|pretend)\s+(?:as\s+)?(?:if\s+)?(?:you\s+(?:are|were)\s+)?(?:though\s+)?(?:a|an)?\s*(?:dan\b|jailbreak|unrestricted|unfiltered)/i,
  /<\s*\/?\s*(?:system|instructions?)\s*>/i,
];

/**
 * PERSONAL DETAIL.
 *
 * Indian mobile numbers are ten digits starting 6-9, usually with +91 or 0 in
 * front and often spaced or hyphenated. The pattern is written to catch the
 * shapes a child actually types, and deliberately not to catch a maths answer:
 * ten digits in a row is a phone number in a tutoring app, and "1234567890" is
 * not an answer anybody writes.
 */
/**
 * Ten digits starting 6-9, with separators wherever the writer felt like one.
 *
 * Written digit-by-digit rather than as fixed 3-3-4 groups because nobody
 * agrees on the grouping: "9876543210", "+91 98765 43210" and "098765-43210"
 * are the same number typed three ways, and only the first matched a fixed
 * pattern.
 *
 * The first FOUR digits must be together, which is what stops it eating a
 * maths answer: "the answer is 6 7 8 9 1 2 3 4 5 0" is ten digits with a
 * space after every one, and nobody writes a phone number like that. The
 * leading [6-9] does the rest — 3.14159, 1947 and 6.022 x 10^23 all fail on
 * the very next character.
 */
const PHONE = /(?:\+?91[\s-]?)?(?:0[\s-]?)?[6-9]\d{3}(?:[\s-]?\d){6}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g;
/**
 * A house number and a street word — enough to find somebody.
 *
 * "plot" was in this list and ate "plot 2 points on the graph and join them",
 * which is a Class 9 Coordinate Geometry instruction and left the model with
 * an empty message. An address in a tutoring app is written the way a courier
 * would need it: a flat or house number, and then something after it. So the
 * word must be one that has no other job in a classroom, the number must be
 * introduced the way an address introduces one, and there has to be more
 * afterwards — a bare "house 4" is a word problem.
 *
 * "address" on its own went the same way "plot" did: "address 3 questions from
 * the exercise tonight" is homework. Only "my address is" survives, which
 * nobody writes about an exercise.
 */
const ADDRESS =
  /\b(?:flat|house\s*no\.?|h\.?\s?no\.?|door\s?no\.?|my\s+address\s+is)\s*[.:#-]?\s*\d+[\w/-]*[,\s]+[\w.\s-]{3,40}/gi;

const MASK = '[removed]';

/** Trim, collapse runs of whitespace, and cap. */
function tidy(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit).trimEnd()}…` : collapsed;
}

/**
 * How much of a student's answer is worth carrying.
 *
 * A spoken answer to "what did you notice?" is a sentence or two. Anything
 * past this is a transcriber running away with background noise, or somebody
 * pasting — and either way it is not evidence about the question that was
 * asked.
 */
export const MAX_STUDENT_WORDS = 1200;

export interface ScreenOptions {
  /** Longest text to carry forward. Defaults to MAX_STUDENT_WORDS. */
  limit?: number;
}

const matches = (patterns: RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));

/**
 * Look at one piece of text, in one direction, and say what to do with it.
 *
 * Order is the design. Distress outranks everything — a child who says
 * something serious inside a sentence that also trips an off-limits pattern
 * gets support, not a refusal. Instructions and personal detail are cleaned
 * rather than refused, because the student did nothing wrong by typing them.
 */
export function screen(
  text: string,
  direction: Direction,
  options: ScreenOptions = {},
): Verdict {
  const limit = options.limit ?? MAX_STUDENT_WORDS;
  const tidied = tidy(text, limit);
  if (tidied === '') return { kind: 'allow', text: '' };

  if (matches(DISTRESS, tidied)) return { kind: 'support', say: SUPPORT_REPLY };

  // Only a STUDENT can ask for something off-limits. The same pattern in her
  // own words is her declining it, and refusing her own refusal would be a
  // loop with a silent tutor at the end of it.
  if (direction === 'from-student' && matches(OFF_LIMITS, tidied)) {
    return { kind: 'redirect', say: REDIRECT_REPLY };
  }

  const removed: Removed[] = [];
  let cleaned = tidied;

  if (direction === 'from-student' && matches(INSTRUCTION, cleaned)) {
    // Every occurrence, not the first: "ignore your instructions. also ignore
    // your instructions" left the second one standing in the prompt. The
    // patterns are written without /g so that .test() has no lastIndex to
    // carry between calls, so the flag is added here instead.
    for (const pattern of INSTRUCTION) {
      cleaned = cleaned.replace(new RegExp(pattern.source, `${pattern.flags}g`), MASK);
    }
    removed.push('instruction');
  }

  const before = cleaned;
  cleaned = cleaned.replace(PHONE, MASK);
  if (cleaned !== before) removed.push('phone');

  const beforeEmail = cleaned;
  cleaned = cleaned.replace(EMAIL, MASK);
  if (cleaned !== beforeEmail) removed.push('email');

  const beforeAddress = cleaned;
  cleaned = cleaned.replace(ADDRESS, MASK);
  if (cleaned !== beforeAddress) removed.push('address');

  if (removed.length > 0) return { kind: 'clean', text: cleaned.trim(), removed };
  return { kind: 'allow', text: cleaned };
}

/**
 * The student's own words, safe to put inside a prompt.
 *
 * Quotes and newlines are what let a transcript escape its quoted block and
 * read as a new turn, so both are neutralised. Combined with `screen`, this is
 * what stops an answer box being a second system prompt.
 */
export function quoteForPrompt(text: string, limit = MAX_STUDENT_WORDS): string {
  return tidy(text, limit).replace(/[\\"]/g, ' ').replace(/[\r\n]+/g, ' ');
}
