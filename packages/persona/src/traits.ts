/**
 * WHO SHE IS — the one tutor, as data rather than prose.
 *
 * There is exactly one persona in this product. Not one per lesson, not one
 * per subject, not one per class. A student who meets a different teacher in
 * every video has met no teacher at all, and the seam between the recording
 * and the live doubt agent only disappears if both sides are unmistakably the
 * same person.
 *
 * Her character itself is the v3 core (meera.ts), which every model call opens
 * on. What lives here is the little the rest of the app reads by name: what she
 * is called, her role in one line, how she sounds, and the voice she is
 * synthesised with. The old `values`, `neverDoes` and `safety` lists were
 * retired on 2026-10-11, when v3's core and safety block replaced them in every
 * prompt; the phrases she never says are BANNED_PHRASES in meera.ts.
 */

export interface TutorTraits {
  /** What the student calls her. Used in greetings and as her shape's label (the app's Bloub). */
  name: string;
  /**
   * One line: what she is. It opens the core ("You are Meera, <role>: ..."),
   * so it says nothing about who the learner is (age, class, board: the app
   * injects those) and does not announce an AI (Aarav, 2026-10-10: she says
   * what she is only when asked; the app's own screens say it plainly).
   */
  role: string;
  /**
   * One line: how she sounds, in PROSE, for a human deciding whether a draft
   * line fits her, and for the class planner. Never fed to a speech
   * synthesiser — that is `speechVoiceName`, which is a different thing
   * entirely.
   */
  voice: string;
  /**
   * The prebuilt Gemini voice her words are synthesised with, by name.
   *
   * It lives beside her character rather than in whichever module happens to
   * call a speech API, because the recorded class and the live doubt tutor are
   * synthesised by two different calls, and a student hears them minutes apart
   * inside one lesson. If those two ever read different names, the handoff
   * stops being a seam and becomes a second teacher taking over the room. One
   * constant that both sides read is the only way to guarantee they cannot
   * drift.
   */
  speechVoiceName: string;
}

export const TUTOR: TutorTraits = {
  name: 'Meera',
  // Aarav, 2026-10-07: "Meera is a friendly teacher". v3's core opens on it.
  role: 'a warm, friendly teacher',
  voice: 'a warm, patient school teacher who explains rather than lectures, and who is glad you asked',
  // Sulafat is the one voice Google labels Warm, and the only one verified to
  // work on BOTH the text-to-speech models and the Live API — which is what
  // lets the recording and the live tutor be the same person out loud.
  speechVoiceName: 'Sulafat',
};
