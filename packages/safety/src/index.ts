// The content-safety layer: what a child says, and what she says back.
//
// Pure and local — no model call, no network — so it sits IN FRONT of the
// network rather than behind it, and a flagged sentence never has to leave the
// device to be recognised.
//
// `screen` DECIDES; `redact` only CLEANS. Both are exported because the two
// jobs are genuinely separate: a caller that has already decided what to do
// with a child's words — file the report, put a helpline in front of them —
// still needs to know what is safe to carry, and screen's `support` and
// `redirect` verdicts hand back no text at all.
export {
  HELPLINES,
  HELPLINE_WORDS,
  isSupportReply,
  spokenSupportReply,
  supportReply,
  type SupportLanguage,
  MASK,
  MAX_DISTRESS_SCAN_CHARS,
  MAX_STUDENT_CHARS,
  /** @deprecated Use MAX_STUDENT_CHARS; the same number under its old, wrong name. */
  MAX_STUDENT_WORDS,
  REDIRECT_REPLY,
  SUPPORT_REPLY,
  quoteForPrompt,
  redact,
  screen,
  type Direction,
  type Redaction,
  type Removed,
  type ScreenOptions,
  type Verdict,
} from './screen';
