// The content-safety layer: what a child says, and what she says back.
//
// Pure and local — no model call, no network — so it sits IN FRONT of the
// network rather than behind it, and a flagged sentence never has to leave the
// device to be recognised.
export {
  HELPLINES,
  MAX_STUDENT_WORDS,
  REDIRECT_REPLY,
  SUPPORT_REPLY,
  quoteForPrompt,
  screen,
  type Direction,
  type Removed,
  type ScreenOptions,
  type Verdict,
} from './screen';
