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
  //
  // THE SUBJECT IS WRITTEN THE WAY IT IS TYPED. These two used to demand a
  // space after "i" — `\bi\s+(?:...|'m going|...)`, `\bi\s+(?:...|'ll)` — so
  // "I'm going to kill myself" and "I'll kill myself", the commonest way those
  // sentences are written, matched nothing; "i wanna die" was only heard as
  // "i wanna to die" (both are heard now). `i\s*'?m` takes "I'm", "im" and
  // "i m"; `i\s*'?ll` takes "I'll" and "ill". A curly apostrophe is
  // straightened before any of this runs (see `screen`). One adverb may sit
  // between: "i just wanna die".
  //
  // Wanting, needing, planning or being about to: "die" counts here.
  /\bi(?:\s+(?:just|really|honestly|seriously|sometimes|actually))?(?:\s+(?:want|need|plan)\s+to|\s+wanna(?:\s+to)?|\s+am\s+(?:going\s+to|gonna)|\s*'?m\s+(?:going\s+to|gonna))\s+(?:just\s+)?(?:die(?![\w-])|kill\s+myself|end\s+(?:it(?![\w-])|my\s+life)|hurt\s+myself|harm\s+myself|(?:commit\s+)?suicide(?![\w-]))/i,
  // "will", "might", "may", "should": NOT "die" — "I will die of boredom" and
  // "I might die if the exam is tomorrow" are a Class 8 student being
  // dramatic, and the list has never counted them.
  /\bi(?:\s+(?:just|really|honestly|seriously|sometimes|actually))?(?:\s+(?:will|might|may|should)|\s*'?ll)\s+(?:just\s+)?(?:kill\s+myself|end\s+(?:it(?![\w-])|my\s+life)|hurt\s+myself|(?:commit\s+)?suicide(?![\w-]))/i,
  // Any tense, because a child says "I have been cutting myself" far more
  // often than "I cut myself". "kill" joined this list with the contractions:
  // "gonna kill myself lol" has no "i" in it at all.
  /\b(?:kill|killing|hurting|harming|cutting|cut|harm|hurt)\s+myself\b/i,
  /\bi\s+(?:do\s*n[o']?t|don'?t)\s+(?:want\s+to|wanna)\s+(?:live|be\s+alive|be\s+here)\b/i,
  /\bi\s+(?:wish|want)\s+i\s+(?:was|were)\s+dead\b/i,
  /\bi\s+wish\s+i\s+(?:was|were|had)\s+(?:never|not)\s+(?:been\s+)?born\b/i,
  /\bno\s+(?:point|reason)\s+in\s+living\b/i,
  /\bend\s+my\s+life\b/i,
  // Being hurt by someone.
  /\b(?:someone|somebody|my\s+(?:father|mother|dad|mum|mom|uncle|aunt|brother|sister|teacher|sir|maam|ma'am))\s+(?:is\s+)?(?:hit|hits|hitting|beat|beats|beating|hurt|hurts|hurting|touch|touches|touching)(?:ing)?\s+me\b/i,
  /\bi\s+am\s+(?:being\s+)?(?:beaten|abused|molested)\b/i,
  /\bhe\s+touch(?:es|ed)?\s+me\b/i,
  /\bafraid\s+to\s+go\s+home\b/i,

  /**
   * THE SAME SENTENCES IN THE LANGUAGE THE CHILD IS BEING TAUGHT IN.
   *
   * Every pattern above is English, and this list has always been the screen on
   * BOTH directions — the tutor's narration on its way out, and a student's own
   * words on their way back in through /api/hear. The product has always
   * expected Hinglish from students (tutor-judge's matcher is built for "wo
   * lamba wala" and "B hoga na"), so an English-only distress list has always
   * been a hole; the language thread, which makes the tutor SPEAK Hinglish
   * first, is what turns it from a hole into the likely case.
   *
   * "mujhe marna hai" and "papa mujhe maarte hain" are what a frightened Class
   * 8 student actually types. Neither matched anything.
   *
   * ROMANISED HINDI HAS NO SPELLING, which is the hard part and the reason this
   * is a FLOOR and never a ceiling. One child writes "mujhe", the next "muje",
   * the next "mjhe"; "nahi" is also "nhi" and "nahin"; "hai" is also "h". The
   * alternations below cover the spellings that actually appear, and they will
   * miss one. A regex list cannot be complete here in the way it nearly can be
   * in English, and pretending otherwise in a comment would be worse than the
   * gap. NOT VERIFIED against any corpus of real student writing: there is none
   * in this repository.
   *
   * The asymmetry that sets the threshold is the one stated above and it is
   * sharper here. A false positive costs a warm sentence and a phone number.
   * A false negative is a child who asked for help in their own language and
   * was answered with a physics explanation.
   */
  /**
   * ROMAN SCRIPT IS NOW THE COMMON CASE, NOT THE TYPED ONE. Since 2026-09-29
   * the ear (Vertex Gemini) writes a spoken Hinglish sentence down in Roman
   * letters, capitals and full stops included, so everything a child SAYS in
   * Hinglish arrives here in the spellings below. The additions of that date
   * are marked; each one is a phrase that matched nothing before.
   *
   * Written around the syllabus, which says the same words about other
   * people: "Hitler ne suicide kar liya tha", "Hamlet suicide karna chahta
   * tha", "Bhagat Singh ne desh ke liye apni jaan de di", "paudha mar jaata
   * hai". hinglishDistress.test.ts holds those lines and they must stay
   * quiet. Where a phrase is only distress in the first person, the pattern
   * asks for a first person — a subject, a first-person verb ending, or a
   * present tense — rather than for the word alone.
   */
  // Intent about oneself: "mujhe marna hai", "mujhe mar jana hai", and
  // (2026-09-29) "mujhe mar jana chahiye".
  /\b(?:mujhe|muje|mujhy|mjhe)\s+(?:ab\s+)?(?:mar|maar)(?:\s*na|\s+jana|\s+jaana)\s+(?:hai|hain|h|chahiye|chahie)\b/i,
  // "main mar jaunga", "mai mar jaungi", "main mar jaun".
  /\b(?:main|mai|m|ab)\s+(?:mar|maar)\s+ja(?:a)?(?:unga|ungi|un|au)/i,
  // "ab mar jaunga", "Mar jaaunga main." (2026-09-29). "-unga"/"-ungi" is
  // first person on its own, so no subject is asked for. It also hears the
  // idiom "hass hass ke mar jaunga" (I will die laughing), which the
  // asymmetry above accepts: a warm sentence, not a missed child.
  /\b(?:mar|maar)\s+ja(?:a|o)?(?:unga|ungi|onga|ongi)\b/i,
  // "main marna chahta hoon", "mai mar jaana chahti thi" — first person, any
  // tense (2026-09-29).
  /\b(?:main|mai|m)\s+(?:ab\s+)?(?:marna|mrna|mar\s+ja(?:a)?na)\s+chaht[aie]/i,
  // "mar jana chahti hu", "marna chahta hoon" with the subject dropped — the
  // present only, because "wo desh ke liye marna chahta tha" is a history
  // lesson about someone else (2026-09-29). "maarna" (to kill, to hit) is
  // left out: "cockroach ko maarna chahta hu" is a question about a spray.
  /\b(?:marna|mrna|mar\s+ja(?:a)?na)\s+chaht[aie](?!\s+th[aie]\b)/i,
  // "jeena nahi chahta", "jina nhi chahti".
  /\b(?:jee?na|jina|jeene|jine)\s+(?:nahi+n?|nhi|nai)\s+chaht?(?:a|i|e)\b/i,
  // "ab nahi jeena chahta", "mujhe ab jeena nahi hai" (2026-09-29).
  /\b(?:nahi+n?|nhi|nai)\s+(?:jee?na|jina)\s+(?:chaht[aie]|hai|h)\b/i,
  /\b(?:jee?na|jina)\s+(?:nahi+n?|nhi|nai)\s+(?:hai|h)\b/i,
  // "jeene ka mann nahi", "jine ka dil nahi karta".
  /\b(?:jee?ne|jine)\s+ka\s+(?:mann?|dil)\s+(?:nahi+n?|nhi|nai)\b/i,
  // "marne ka mann karta hai", "mar jaane ka dil hota hai", "marne ke khayal
  // aate hain", "marne ki ichha" (2026-09-29). "marne ka mann NAHI karta" is
  // not heard: the word after "mann" has to be the feeling, not its denial.
  /\b(?:marne|mar\s+ja(?:a)?ne)\s+ka\s+(?:mann?|dil|khayal|khyal)\s+(?:karta|karti|kar\s+rah[aie]|hota|hoti|aata|aati|hai|h)\b/i,
  /\bmarne\s+(?:ke|ka)\s+(?:khayal|khyal|vichar|vichaar)\b/i,
  /\bmarne\s+ki\s+(?:ichha|ichchha|iccha|ichcha|soch)\b/i,
  // "zinda nahi rehna", "zinda rehna nahi chahta".
  /\bzinda\s+(?:nahi+n?|nhi|nai)\s+reh/i,
  /\bzinda\s+reh(?:na)?\s+(?:nahi+n?|nhi|nai)\b/i,
  // The nouns, and ONLY with intent attached — "suicide" alone matches nothing
  // above for the same reason: a history chapter is not a helpline.
  /\b(?:khud\s*kushi|khudkhushi|atmahatya|aatmhatya|aatmahatya)\b[^.!?]{0,30}\b(?:kar|karna|karunga|karungi|karni|kr)\b/i,
  // The English noun in a Hindi sentence, "suicide kar" (2026-09-29). Unlike
  // the line above it asks for more than a nearby "kar", because "Hitler ne
  // suicide kar liya tha" is a Class 9 history answer. So: a first-person
  // subject straight before it ("main suicide kar lunga", "mujhe suicide
  // karna hai") in any tense ...
  /\b(?:main|mai|m|mujhe|muje|mujhy|mjhe)\s+(?:ab\s+)?suicide\s+kar/i,
  // ... or, with no subject, a first-person or wanting form of "kar":
  // "suicide karungi", "suicide kar lunga", "suicide karna hai", "suicide
  // karne ka mann", and "suicide karna chahta" in the present only, which is
  // what keeps "Hamlet suicide karna chahta tha kya" quiet.
  /\bsuicide\s+(?:karna\s+(?:hai|h|chahiye|chaht[aie](?!\s+th[aie]\b))\b|karni\s+(?:hai|h)\b|karu(?:n|nga|ngi)?\b|karoon(?:ga|gi)?\b|kar\s+(?:lu|lun|loon|lunga|lungi|loonga|loongi)\b|karne\s+(?:ka|ki|ke)\s+(?:mann?|dil|soch|khayal|khyal|vichar|irada))/i,
  // "apne aap ko maar", "khud ko nuksan", and (2026-09-29) "khud ko khatm",
  // "khud ko kaat". "hurt" and "harm" are NOT here: "lab me khud ko hurt mat
  // karna" is a safety line a tutor says out loud. ("chot" carries the same
  // exposure — "khud ko chot mat lagana" — and was here first; left as it was.)
  /\b(?:apne\s+aap|khud)\s+ko\s+(?:maar|mar|nuksan|nuksaan|chot|khatam|khatm|khtm|kaat)/i,
  // "apni zindagi khatam karna chahti hu", "apni life end kar lunga"
  // (2026-09-29) — an intent form of "kar" only, so that a story's "usne apni
  // zindagi khatam kar li" is not a helpline.
  /\b(?:apni|meri)\s+(?:zindagi|zindgi|jindagi|life)\s+(?:khatam|khatm|khtm|end)\s+(?:karna|karni|karunga|karungi|karu|karun|kar\s+(?:lu|lun|loon|lunga|lungi|du|dun|doon|dunga|dungi))\b/i,
  // "apni jaan le lunga", "apni jaan lena chahta hu" (2026-09-29). Taking,
  // not giving: "desh ke liye apni jaan de di" is Bhagat Singh.
  /\bapni\s+jaan\s+(?:le\s+(?:lu|lun|loon|lunga|lungi|loonga|loongi)|lena\s+(?:chaht[aie]|hai|h))\b/i,

  // Being hurt by someone, named the way a child names them.
  /\b(?:papa|pappa|pita|mummy|mumma|maa|ammi|abbu|bhai|bhaiya|didi|chacha|chachi|mama|mami|tau|sir|madam|teacher)\s+(?:mujhe|muje|mujhy|mjhe)\s+(?:bahut\s+)?(?:maar|mar|peet|pit)/i,
  // "mujhe maarta hai", "muje peetti hai" — the person unnamed.
  /\b(?:mujhe|muje|mujhy|mjhe)\s+(?:roz\s+|bahut\s+)?(?:maar|mar|peet|pit)(?:ta|ti|te|tha|thi)\s+(?:hai|hain|h)\b/i,
  // "ghar jane se darr lagta hai".
  /\bghar\s+ja(?:ne|na)\s+se\s+dar/i,
  // "galat tarike se chhuta hai", "mujhe galat jagah chhua".
  /\b(?:mujhe|muje|mujhy|mjhe)\s+galat\s+(?:tarike\s+se\s+|jagah\s+)?(?:chu|chh?u|chhoo|choo)/i,
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

/**
 * What stands in the place of anything taken out.
 *
 * Exported so that anything asserting on it, or one day showing it, names the
 * token this file writes rather than a second copy that drifts from it. No UI
 * shows it today: the confirmation copy in apps/classroom/src/ui/
 * ReportSheet.tsx names what was removed ("phone numbers and email addresses")
 * rather than the marker left behind. packages/safety/tests/redact.test.ts is
 * the only reader.
 */
export const MASK = '[removed]';

/** Trim and collapse runs of whitespace. No cap: see `tidy` for that. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Cap text that is already collapsed, marking the cut with an ellipsis. */
function cap(collapsed: string, limit: number): string {
  return collapsed.length > limit ? `${collapsed.slice(0, limit).trimEnd()}…` : collapsed;
}

/** Trim, collapse runs of whitespace, and cap. */
function tidy(text: string, limit: number): string {
  return cap(collapse(text), limit);
}

/**
 * How much of a student's answer is worth CARRYING — into a prompt, onto a
 * board, into a report. It is a count of characters, not words; it was named
 * MAX_STUDENT_WORDS while comparing `.length`, which is how a long
 * typed answer came to be cut at 1,200 characters before grading without the
 * name ever saying so.
 *
 * A spoken answer to "what did you notice?" is a sentence or two. Anything
 * past this is a transcriber running away with background noise, or somebody
 * pasting — and either way it is not evidence about the question that was
 * asked.
 *
 * It is NOT how much of a child is listened to. `screen` reads for distress
 * across MAX_DISTRESS_SCAN_CHARS first, and only then cuts to this.
 */
export const MAX_STUDENT_CHARS = 1200;

/**
 * The old name for MAX_STUDENT_CHARS, the same number.
 *
 * @deprecated Use MAX_STUDENT_CHARS. Nothing in this checkout imports the old
 * name any more; it stays exported because the package index exported it, and
 * a checkout on another branch (the LMS worktree carries its own copy of this
 * package) may still import it.
 */
export const MAX_STUDENT_WORDS = MAX_STUDENT_CHARS;

/**
 * How far into a piece of text `screen` reads for distress.
 *
 * Until 2026-09-29 the distress scan ran on the CAPPED text, so 1,500
 * characters of an ordinary answer followed by "mujhe marna hai" was cut
 * before anything read the end of it, and the tutor carried on teaching. Now
 * the scan runs first, on up to this many characters of the collapsed text, or
 * on the caller's own limit where that is longer — so nothing is ever carried
 * that the scan did not read.
 *
 * The cap exists so a transcriber that ran for an hour, or a paste of a whole
 * chapter, cannot make every distress pattern walk all of it. A distress line
 * that does not END before this point is NOT heard; at the default limit it is
 * not carried either, so it reaches no model and no board. What it costs to
 * scan 20,000 characters on a low-end phone is UNVERIFIED — no one has timed
 * it. The distress patterns are anchored on words, and the only gap in them
 * that can span other words is bounded at 30 characters.
 */
export const MAX_DISTRESS_SCAN_CHARS = 20_000;

export interface ScreenOptions {
  /**
   * Longest text to carry forward, in characters. Defaults to
   * MAX_STUDENT_CHARS. `screen` reads for distress past it (see
   * MAX_DISTRESS_SCAN_CHARS); everything else — the off-limits check and the
   * masking — runs on the carried text only, because that is the only text
   * that travels.
   */
  limit?: number;
}

const matches = (patterns: RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));

/** What the masking pass took out, and what is left. */
export interface Redaction {
  /** The same words with every match replaced by MASK. */
  text: string;
  /** Which kinds of thing were taken out; empty when nothing was. */
  removed: Removed[];
}

/**
 * THE MASKING PASS, ON ITS OWN AND WITH NO OPINION.
 *
 * `screen` answers four ways and only two of them hand text back. The two that
 * do not — `support` and `redirect` — are the verdicts a child's most serious
 * words take, so the one note that most needs to reach a person was also the
 * one note with no cleaned copy in existence. apps/classroom/src/ui/
 * ReportSheet.tsx could therefore only withhold such a note: an operator saw
 * that a child had reported something and could not see what.
 *
 * This is the half that was missing. It masks and it stops: no distress
 * judgement, no reply, no verdict. A caller that has ALREADY decided what to
 * do — file it, flag it, put a helpline in front of the child — can still ask
 * what is safe to carry.
 *
 * IT IS THE ONLY COPY OF THE MASKING. `screen` calls this rather than
 * repeating it, because two sets of these patterns would drift and the quiet
 * one would be the copy protecting children. packages/safety/tests/
 * redact.test.ts asserts the two agree byte for byte on the clean path.
 *
 * It DEFAULTS to 'from-student', which is the cautious direction: the
 * instruction patterns only fire that way, so a caller who forgets the
 * argument gets more masking rather than less.
 */
export function redact(
  text: string,
  direction: Direction = 'from-student',
  options: ScreenOptions = {},
): Redaction {
  const removed: Removed[] = [];
  let cleaned = tidy(text, options.limit ?? MAX_STUDENT_CHARS);

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

  return { text: cleaned, removed };
}

/**
 * Look at one piece of text, in one direction, and say what to do with it.
 *
 * Order is the design. Distress outranks everything — a child who says
 * something serious inside a sentence that also trips an off-limits pattern
 * gets support, not a refusal. Instructions and personal detail are cleaned
 * rather than refused, because the student did nothing wrong by typing them.
 *
 * LISTEN FIRST, CUT SECOND. Distress is looked for in the collapsed text
 * BEFORE it is capped, across MAX_DISTRESS_SCAN_CHARS or the caller's limit,
 * whichever is longer. The cap used to come first, and a child who wrote a
 * long answer and said the serious thing at the end of it was cut off before
 * anything read that far. Everything after the distress check — off-limits,
 * instructions, personal detail — looks only at the capped text, because
 * that is all that is carried anywhere.
 */
export function screen(
  text: string,
  direction: Direction,
  options: ScreenOptions = {},
): Verdict {
  const limit = options.limit ?? MAX_STUDENT_CHARS;
  const collapsed = collapse(text);
  if (collapsed === '') return { kind: 'allow', text: '' };

  // Math.max so that a caller carrying more than the scan cap (screenSpine
  // passes each string's own length) never gets back text the scan skipped.
  // The curly apostrophes are straightened for the scan only: a phone keyboard
  // types "I’m", and every English pattern above is written with "'".
  const heard = collapsed
    .slice(0, Math.max(MAX_DISTRESS_SCAN_CHARS, limit))
    .replace(/[\u2018\u2019\u02BC]/g, "'");
  if (matches(DISTRESS, heard)) return { kind: 'support', say: SUPPORT_REPLY };

  const tidied = cap(collapsed, limit);

  // Only a STUDENT can ask for something off-limits. The same pattern in her
  // own words is her declining it, and refusing her own refusal would be a
  // loop with a silent tutor at the end of it.
  if (direction === 'from-student' && matches(OFF_LIMITS, tidied)) {
    return { kind: 'redirect', say: REDIRECT_REPLY };
  }

  /**
   * The masking itself lives in `redact` — one copy, two callers.
   *
   * `tidied` is handed in already tidied and `redact` tidies again. That is a
   * no-op rather than a second truncation: collapsing whitespace twice changes
   * nothing, and in the over-long branch the ellipsis `cap` appends is the
   * only character past the limit, so the second pass re-slices to the same
   * string. redact.test.ts pins that on a note longer than the limit rather
   * than leaving this paragraph as a claim.
   */
  const { text: cleaned, removed } = redact(tidied, direction, { limit });

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
export function quoteForPrompt(text: string, limit = MAX_STUDENT_CHARS): string {
  return tidy(text, limit).replace(/[\\"]/g, ' ').replace(/[\r\n]+/g, ' ');
}
