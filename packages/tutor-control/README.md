# @ai-tutor/tutor-control

**What does the tutor do next?** A pure `decide(input) → Action` over the judge's
verdict and the ask's authored content. 0 model calls, no clock (`now` is passed in),
no randomness, no I/O. The same input always gives the same action.

E1a of the tutor build plan (`docs/handoff/2026-09-26-state-of-play.md`, T2). **Not
wired into any app yet.** Wiring it is E2/E3 work, through the headless held-ask
controller (T1.9).

## What it does

- **The ladder (TD1).** A wrong or unmatched answer climbs one delivered step at a time:
  L1 a rethink line → L3 the authored hint (the chosen wrong option's `hint`, else the
  ask's) → L5 a worked example, only where one is authored (none is yet; C6 adds them)
  → L8 the answer and why → move on and retest. A rung with nothing usable is skipped,
  never filled with invented words. Attempt 2 or later counts as at least L1.
- **Everything else.** Right → brief, specific praise with the authored why, and a
  retest after any help. Silent → a content-free nudge, filed as L1 help without moving
  the ladder. Unclear → "say that again", no help. A hint request climbs to L3 and no
  further. A verdict that its own matched option contradicts → "say that again", never
  praise.
- **History (lam-one-brain Task 6).** An optional `history` the caller works out from the
  learner model changes three moves, each opened by a fixed recognition phrase
  (`RECOGNISE`): a wrong idea shown before gets another way to explain it (L7) instead of
  "look again"; an outcome missed cold again and again gets a worked example (L5) first;
  help asked for before any try, by a child who keeps doing that, gets "try it yourself
  first" with no help filed. With no history the ladder is unchanged.
- **Lines.** Every `say` is a fixed persona line (`src/lines.ts`, English and Hinglish in
  Roman script) or authored content framed by one. The newest line spoken is never
  chosen again.
- **The leak check.** `leaks(text, mustNotReveal)` normalises case, spacing,
  punctuation and English number words 0-100. `decide()` refuses authored content that
  leaks the answer. Its blind spots (paraphrase, romanised Hindi number words) are listed
  in `src/leak.ts`.
- **The ledger (E3).** `recordsFor(action, ref)` gives the `helped` row (when the action
  helps) and the `intervened` row (always), in the order they must be filed: before
  anything is said or written.

## What the caller must do

Speak `say` only through the app's safety screen (`screenedSpeech` / `toStudent`),
route a halted result to `haltSession()`, run `leaks()` on anything a model adds, and
file `recordsFor` first.

Response-time rules (`timing.rules`) are built and **off** until TD14 is answered.
