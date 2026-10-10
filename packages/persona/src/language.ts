/**
 * WHICH LANGUAGE SHE SPEAKS — the child's choice, as one line of prompt.
 *
 * Every student picks it once, at onboarding or on the contest form, and the
 * app stores it as `tutorLanguage` in the workspace
 * (apps/classroom/src/lib/workspace.ts). The app's own screens are English for
 * everyone; this is only the voice of the person teaching.
 *
 * Until this module existed the choice reached exactly one prompt: the class
 * planner's, through `HINGLISH_REGISTER` in packages/class-prep. The judge, the
 * close and the live doubt tutor were told nothing, so a Hinglish class
 * narrated in Hinglish and then answered the child's first answer in English.
 * One line, rendered identically into all of them, is what makes the class and
 * the conversation around it one voice.
 *
 * WHY ONE PARAGRAPH AND NOT class-prep's REGISTER. `HINGLISH_REGISTER` is a
 * page, and most of it is about which JSON FIELDS of a lesson stay English —
 * a question the judge and the doubt tutor never face, because they emit one
 * spoken sentence or two. They are also paid for on every turn rather than once
 * per class, so the module is capped (tests/language.test.ts holds it to 650
 * characters, raised from 200 on purpose for v3's grammar rules).
 *
 * WHETHER IT WORKS IS UNVERIFIED. The plan's bar for this (docs/handoff
 * 2026-09-26-state-of-play.md, row H2) is a 30-item labelled set: at least 90%
 * of replies to Hinglish students in Hinglish and at least 95% of replies to
 * English students in English. Nobody has run that set. What the tests here
 * prove is that the right line reaches the prompt, not that the model obeys it.
 */

/**
 * The two spellings the app stores — the same two `workspace.ts` validates on
 * the way in and packages/tutor-control and packages/class-prep declare. A
 * third value is not a language, it is a bug reaching a child's class.
 */
export const TUTOR_LANGUAGES = ['en', 'hi-en'] as const;

export type TutorLanguage = (typeof TUTOR_LANGUAGES)[number];

/**
 * The language module each language renders, verbatim, wherever she speaks:
 * persona v3's LANGUAGE blocks (Aarav, 2026-10-10). English is the base;
 * Hinglish is a module for a learner who chose it, not part of who she is.
 * Neither names the learner's age or class: the app injects that (factors.ts).
 *
 * 'hi-en' is pinned word for word by a test. It names Roman script and forbids
 * Devanagari for a safety reason as well as a style one: every reply passes
 * the safety screen before a child hears it, and packages/safety/src holds 0
 * Devanagari characters (counted 2026-09-29), so a reply in Devanagari would
 * pass a screen that cannot read it. It also keeps "tum", her own female
 * grammar, and gender-free words for the learner; the second-person futures
 * it forbids are filtered in code as well (meera.ts, neutralLearnerVerbs),
 * because the 5-draw test showed about 8% of replies still used one.
 *
 * 'en' deliberately never mentions Hinglish, so a test can assert that an
 * English child's prompt carries no Hinglish instruction of any kind. It keeps
 * her in English when the child mixes in Hindi, because the child chose
 * English for the TUTOR's voice; how the child answers is judged on its idea,
 * not its language, by a separate rule.
 */
export const REGISTER: Readonly<Record<TutorLanguage, string>> = {
  en: 'Plain, warm Indian English in short sentences. Stay in English even if they mix in Hindi.',
  'hi-en':
    'Speak Hinglish in Roman script, never Devanagari: English only for subject terms, plain spoken Hindi for the rest. Say "tum" to them, never "aap" or "tu". You are a woman ("main samjhati hoon"); for them use words that carry no gender ("samajh aaya?", "batao", "socho"): never future forms such as "samjhaoge", "karoge", "miloge", say "samjhao", "karo", "milte hain" instead, unless their own sentence shows their gender. Say "shukriya", not "thank you", and never "wah", "shabash" or "bilkul sahi" as praise. Everyday numbers in Hindi words, maths in English words.',
};

/** Whether a value is one of the two languages, rather than trusting its type. */
export const isTutorLanguage = (value: unknown): value is TutorLanguage =>
  (TUTOR_LANGUAGES as readonly unknown[]).includes(value);

/** The register line for one language. */
export function registerLine(language: TutorLanguage): string {
  return REGISTER[language];
}
