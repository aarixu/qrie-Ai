/**
 * THE PREP-SIDE NARRATION SCREEN — closing the first-student gap.
 *
 * The keep gate (packages/relay/src/relays.ts) screens narration on the
 * server, and it is real — but it runs when a class is KEPT, roughly eighty
 * seconds after a cold topic started teaching. The FIRST student on a topic
 * hears the narration ~14s in, screened by nobody. This runs the same screen
 * at assembly, before the draft is handed out, so the student who pays the
 * prep wait is not also the one who takes the risk.
 *
 * By relative path, for the same reason `safety.ts` reaches the relay's
 * markup gate that way: two implementations drift, and a gate that has
 * drifted from the one the server enforces is a gate that lies about what
 * the server will do with the class later.
 *
 * The posture is REJECT on a support verdict, never sanitise — the caller of
 * prepareClass already treats a throw as "no class", and masking a line out
 * of a lesson produces a sentence nobody wrote. Verdicts short of support
 * pass: `screen` only redirects student-direction text, and a phone number in
 * a physics word problem is the keep gate's judgement call, not a reason to
 * refuse the first student a class the second student would get.
 */
import type { Lesson } from '@ai-tutor/lesson-format';
import { screen } from '../../safety/src/screen.ts';

/** One line that screened as distress, and where in the spine it sits. */
export interface ScreenedLine {
  /** The beat id, element id, or the part of the lesson it came from. */
  where: string;
  /** The offending text — for the operator's log, never for the student. */
  text: string;
}

/**
 * Every string leaf under a value, with no field named.
 *
 * Naming fields is the hazard `namesInSpine` records — the whyProbe was
 * exactly the field a name-list would have missed — so this walks whatever is
 * there. It exists ALONGSIDE the stringified whole rather than instead of it
 * because the two miss different things: stringifying escapes a real newline
 * into the two characters 
, and the distress patterns match across `\s+`,
 * so a line broken mid-sentence screens clean as JSON and dirty as text.
 */
const leaves = (value: unknown, into: string[]): string[] => {
  if (typeof value === 'string') {
    if (value.length > 0) into.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) leaves(v, into);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) leaves(v, into);
  }
  return into;
};

/**
 * The spine's spoken and written text, screened; returns whatever screened as
 * distress. Empty means the class may be taught.
 *
 * Beats and elements are screened as their stringified WHOLE **and** as their
 * individual string leaves — the decision `namesInSpine` records, with the
 * escaping hole closed: no field is picked by name in either pass, so the
 * next field added to `Beat` is covered the day it is added. The title and
 * subtitle go in too (they are spoken and shown, and `namesInSpine` already
 * reads them), and so does the fill: it is one student's line, but it is
 * SPOKEN, and it is spoken first.
 *
 * THE LIMIT IS EACH STRING'S OWN LENGTH. `screen` truncates at 1,200
 * (characters, despite the constant's name) by default, which is shorter
 * than one beat's JSON — the default would screen the opening of a beat and
 * wave the rest through, which reads like a gate and is not one. relays.ts
 * documents the same trap and makes the same choice.
 *
 * At most one line per place: the caller refuses on the first one, and a beat
 * reported twice (once escaped, once raw) only makes a log harder to read.
 */
export function screenSpine(lesson: Lesson): ScreenedLine[] {
  const places: { where: string; texts: string[] }[] = [
    { where: 'title', texts: [lesson.title, lesson.subtitle ?? ''] },
    ...lesson.beats.map((b) => ({ where: b.id, texts: [JSON.stringify(b), ...leaves(b, [])] })),
    ...(lesson.fill ?? []).map((f) => ({ where: `fill:${f.beatId}`, texts: [f.say] })),
    ...lesson.elements.map((el) => ({
      where: el.id,
      texts: [JSON.stringify(el), ...leaves(el, [])],
    })),
  ];

  const flagged: ScreenedLine[] = [];
  for (const place of places) {
    const hit = place.texts.find(
      (text) => text.length > 0 && screen(text, 'to-student', { limit: text.length }).kind === 'support',
    );
    if (hit !== undefined) flagged.push({ where: place.where, text: hit });
  }
  return flagged;
}
