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
 * WHY ONE SHORT LINE AND NOT class-prep's REGISTER. `HINGLISH_REGISTER` is a
 * page, and most of it is about which JSON FIELDS of a lesson stay English —
 * a question the judge and the doubt tutor never face, because they emit one
 * spoken sentence or two. They are also paid for on every turn rather than once
 * per class, so the line is capped (tests/language.test.ts holds it to 200
 * characters).
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
 * The line each language renders, verbatim, wherever she speaks.
 *
 * 'hi-en' is Aarav's wording (2026-09-29) and is pinned word for word by a
 * test. It names Roman script and forbids Devanagari for a safety reason as
 * well as a style one: every reply passes the safety screen before a child
 * hears it, and packages/safety/src holds 0 Devanagari characters (counted
 * 2026-09-29) — so a reply in Devanagari would pass a screen that cannot read
 * it.
 *
 * 'en' says "plain Indian English" and deliberately never mentions Hinglish, so
 * a test can assert that an English child's prompt carries no Hinglish
 * instruction of any kind. It keeps her in English when the child mixes in
 * Hindi, because the child chose English for the TUTOR's voice; how the child
 * answers is judged on its idea, not its language, by a separate rule.
 */
export const REGISTER: Readonly<Record<TutorLanguage, string>> = {
  en: 'Speak plain Indian English the way a friendly tutor talks to a Class 6-10 student: short, everyday sentences, no slang, and stay in English even if the student mixes in Hindi.',
  'hi-en':
    'Speak Hinglish the way a friendly Delhi tutor talks to a Class 6-10 student: Hindi sentence structure in Roman script with English science and maths terms; never Devanagari.',
};

/** Whether a value is one of the two languages, rather than trusting its type. */
export const isTutorLanguage = (value: unknown): value is TutorLanguage =>
  (TUTOR_LANGUAGES as readonly unknown[]).includes(value);

/** The register line for one language. */
export function registerLine(language: TutorLanguage): string {
  return REGISTER[language];
}
