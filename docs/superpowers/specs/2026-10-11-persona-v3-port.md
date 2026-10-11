# Persona v3 port: what is built, and the rulings (2026-10-11)

Branch `persona-v3`, cut from `integration/voice-canvas`. Source of truth for WHAT Meera is: Aarav's decisions in
`docs/handoff/2026-10-11-voice-stt-tts-persona-handoff.md` sections 4.3 and 5, and the draft
`tools/voice-probe/persona-draft/meera.mjs` (v3). This file only records HOW it is ported and the rulings the port
needed. Every task is test-first: the test is written, seen red, then the code.

## Fixed by Aarav (not reopened here)

- English is the base. Hinglish is a module chosen per student (`tutorLanguage`: `en | hi-en`): Roman script never
  Devanagari, "tum" (never "aap"/"tu"), Meera's own female grammar ("main samjhati hoon"), gender-free words for the
  learner ("batao", "samajh aaya?"), never second-person future forms ("samjhaoge", "karoge").
- The persona says nothing about students, age, class or board. The app injects the learner lines from the profile.
- A small core goes into EVERY model call: planner, judge, close, doubt (live too, when it is used).
- She says she is an AI only when asked. App text (Help, onboarding) says it once, plainly, so she never has to.
- Her own fixed likes (v3 `LIKES`), mentioned now and then as a taste, never as an experience.
- She talks to the learner only. The child's name is never sent to a model.
- The crisis reply lives in code; the prompt keeps a short backstop. Helplines come from a region table: words when
  spoken, digits when shown.

## Rulings the port makes (each with its cost if wrong)

1. **v3 text is ported verbatim** (`CORE`, `LIKES`, `likesBlock`, the safety block, `LANGUAGE`, `SPEAKING`, `MOVES`),
   except that helpline numbers come from the region table. Cost if wrong: none; a wording change is a one-line diff.
2. **`TUTOR` keeps `name`, `voice`, `speechVoiceName`** (the recorded and the live voice both read it). `role` becomes
   friendly-teacher wording with no "AI", no students, class or syllabus. `values`, `neverDoes` and `safety` are
   retired: v3's CORE and safety block replace them in every prompt, and a list that claims to be "rendered into every
   prompt" while nothing renders it is a false comment. The banned phrases become `BANNED_PHRASES` (data, used by
   tests and by the filter). Cost if wrong: tests that read the old lists are rewritten on purpose.
3. **Composition order** (`buildSystemPrompt`): CORE, LIKES (voice/text only), SAFETY, LANGUAGE, SPEAKING (voice/text),
   THE LEARNER (the app's lines: `describeFactors`), THIS LESSON (+ what it rests on + recallable beats, kept from the
   old prompt because the doubt reply's `recallBeatId` depends on them), PREPARED (conductor payload), THIS TURN (last).
4. **No language set means English** (v3: English is the base), not "no language line". Cost if wrong: an unknown
   value already could not become an instruction; it now becomes the English module.
5. **THIS TURN takes a v3 move OR one of the three doubt moments.** No conductor is wired today (that is
   `lam-one-brain`'s controller work), and the doubt flow's three moments (opening, answering, closing) are the only
   turns that reach a model. Their existing guidance renders as the card. `move`, `rung`, `helped`, `because` and
   `payload` are accepted and tested so the conductor can plug in. Cost if wrong: a doubt turn reads its old card.
6. **`coreFor(language)`** = CORE + SAFETY + LANGUAGE (v3's judge/close bundle), and is put at the top of
   `JUDGE_SYSTEM`, `CLOSE_SYSTEM` and the class planner's system prompt, replacing their own "You are Meera, an Indian
   tutor ..." line and register bullet. The judge/close size ceilings in their tests are raised on purpose, with the
   measured size in the comment. Cost: about 475 tokens more per judge/close call (Aarav's call: core in every call).
7. **Spoken doubts use the `voice` surface, typed ones `text`** (today `geminiAgent.ts` hard-codes `text`).
8. **Gendered learner verbs are filtered in code** for `hi-en` (`neutralLearnerVerbs`): a second-person future ending
   in -oge/-ogi becomes the plain form ("karoge" -> "karo"), on every model reply and fixed line a Hinglish learner
   hears. v3's test showed ~8% of replies still use one; more prompt does not fix it.
9. **Safety in code (`packages/safety`, still zero dependencies):** `HELPLINES` gains `emergency: '112'`; a support
   reply per language (`supportReply('en' | 'hi-en')`) that thanks them, says it is not their fault and not theirs to
   carry alone, gives Tele-MANAS 14416, Childline 1098 and 112 if they are in danger now, and ends on "Are you safe
   right now?". `screen(..., { language })` picks it; the verdict carries the shown text (digits) and a spoken form
   (numbers in words). `SUPPORT_REPLY` stays as the English one. Distress gains the phrasings `screen-check.mjs` showed
   missing, each with a false-positive test (NCERT chapters and homework talk must not trip it). The injection
   pattern accepts "earlier" and "prior". A test pins safety's digits to the persona's region table.
10. **One ban list, scanned everywhere a fixed line reaches a learner:** `packages/tutor-control/src/lines.ts`, the
    bridge and thinking lines, the scripted stub, and the canned replies. Offending lines are rewritten.
11. **Help.tsx** stops saying every class "was taught live once, to real students, and recorded"; Help and onboarding
    say once, plainly, that Meera is an AI tutor.
12. **A test holds the persona text to "no students, age, class or board".**
