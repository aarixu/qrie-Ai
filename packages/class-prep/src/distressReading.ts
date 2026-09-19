import type { LlmAdapter } from './prepare.ts';
import type { ScreenedLine } from './screenSpine.ts';

/**
 * A SECOND READING FOR A LINE THE NARRATION SCREEN FLAGGED.
 *
 * `screenSpine` is a pattern matcher and it cannot read meaning. On the
 * tutor's own narration that is a problem with a hard edge: a flagged line
 * REFUSES THE WHOLE CLASS (prepare.ts throws, and prepareClass's caller treats
 * a throw as "no class"), so a false positive is not a warm sentence and a
 * helpline — it is a topic that cannot be taught at all.
 *
 * MEASURED, NOT FEARED. Eleven ordinary curriculum sentences were run through
 * the screen; SEVEN tripped it:
 *
 *   "kisaan karz ke kaaran atmahatya kar rahe hain"   (NCERT social science)
 *   "Hamlet sochta hai ki jeena nahi chahta"          (literature)
 *   "is kavita me kavi kehta hai jeene ka mann nahi"  (a poem)
 *   "Premchand ki kahani me kisaan kehta hai..."      (reported speech)
 *   "ghar jane se darr lagta hai, ye anxiety ka..."   (the symptom, taught)
 *
 * Each of those would have refused a legitimate class. The patterns are not
 * wrong — a child typing any of them deserves the helpline, and on the
 * `from-student` side they still get it, instantly and with no model in the
 * way. What differs is the DIRECTION: the tutor quoting Premchand is teaching,
 * and the tutor saying it as herself is a model that has gone wrong.
 *
 * Telling those apart needs meaning, so this asks for it — ONE call, only when
 * a line is flagged, which on a science class is approximately never.
 *
 * IT ASKS THE PLANNER, NOT THE REVIEWER. `reviewLesson`'s model is optional
 * (the app passes none; only the pre-warm runner does), so hanging this off it
 * would mean the app — the place a real child is waiting — never got a second
 * reading at all. The planner is always there.
 *
 * FAIL-CLOSED, AND THAT IS THE EXPENSIVE DIRECTION ON PURPOSE. An unreachable
 * model, an unparseable reply, a reply that does not name every line: all of
 * them keep the refusal. This is the same posture `reviewLesson` takes, and it
 * means a network blip costs a class rather than risking a line nobody read.
 */

const SYSTEM = [
  'You are checking one narrow thing about lines from a school lesson written by an AI tutor for Indian students aged 11 to 18. You are NOT judging whether the lesson is good, accurate, or appropriate — something else does that.',
  '',
  'A pattern matcher flagged each line below as possibly expressing distress. It cannot read meaning, so it flags a history lesson about farmer suicides exactly as loudly as a tutor saying she wants to die. Your one job is to tell those apart.',
  '',
  'For each line, answer whether the TUTOR HERSELF is the one in distress — speaking in her own voice, now, about wanting to die or hurt herself, or about someone hurting her.',
  '',
  'Answer "distress": true only for that.',
  'Answer "distress": false when the line is the subject matter — a quotation, a character in a story or poem, a historical or social fact, a statistic, a symptom being explained, a news event, a legal or civics topic. Teaching ABOUT something difficult is not the same as saying it.',
  '',
  'The lines may be in English or in Hinglish (Hindi written in Roman script, the way an Indian teacher speaks in class).',
  '',
  'Reply with ONE JSON object and nothing else:',
  '{"readings":[{"where":"<the where value, copied exactly>","distress":true|false}]}',
  'Include every line you were given, once each.',
].join('\n');

const userFor = (flagged: ScreenedLine[], topic: string, klass: number): string =>
  [
    `The lesson is for Class ${klass}, on: ${topic}`,
    '',
    'The flagged lines:',
    ...flagged.map((f) => `- where: ${f.where}\n  line: ${f.text}`),
  ].join('\n');

/**
 * Narrow the flagged lines to the ones a reader agrees are the tutor in
 * distress. Returns what should still refuse the class — so an empty array
 * means "teach it", and returning the input unchanged is the failure mode.
 */
export async function readDistress(
  flagged: ScreenedLine[],
  opts: { planner: LlmAdapter; topic: string; klass: number },
): Promise<ScreenedLine[]> {
  if (flagged.length === 0) return [];

  let reply: string;
  try {
    reply = await opts.planner.complete(SYSTEM, userFor(flagged, opts.topic, opts.klass));
  } catch {
    // Unreachable. The refusal stands — see the fail-closed paragraph above.
    return flagged;
  }

  const parsed = parseReadings(reply);
  if (parsed === null) return flagged;

  /**
   * EVERY LINE MUST HAVE BEEN READ. A reply that answers two of three leaves
   * the third unjudged, and treating "not mentioned" as "fine" is how a model
   * that ran out of output tokens waves a line through.
   */
  const byWhere = new Map(parsed.map((r) => [r.where, r.distress]));
  if (flagged.some((f) => !byWhere.has(f.where))) return flagged;

  return flagged.filter((f) => byWhere.get(f.where) === true);
}

/** The reply's readings, or null when it is not the shape that was asked for. */
function parseReadings(reply: string): { where: string; distress: boolean }[] | null {
  // The planner is asked for bare JSON and sometimes fences it anyway.
  const text = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const readings = (value as { readings?: unknown })?.readings;
  if (!Array.isArray(readings)) return null;

  const out: { where: string; distress: boolean }[] = [];
  for (const r of readings) {
    const where = (r as { where?: unknown })?.where;
    const distress = (r as { distress?: unknown })?.distress;
    // A missing or non-boolean verdict is not a verdict. Refusing the whole
    // reply is safer than reading one bad entry as "false".
    if (typeof where !== 'string' || typeof distress !== 'boolean') return null;
    out.push({ where, distress });
  }
  return out;
}
