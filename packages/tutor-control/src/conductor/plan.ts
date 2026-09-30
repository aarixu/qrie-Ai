import { leaks } from '../leak.ts';
import type { AlternateMode, TeachingPlan } from './types.ts';

/**
 * IS THIS A PLAN THE CONDUCTOR CAN RUN, AND ONE WHOSE HELP TEXT DOES NOT GIVE
 * THE ANSWER AWAY — AS FAR AS THE LEAK CHECK CAN TELL?
 *
 * A plan is written once per topic (by a model, or by hand) and read by the
 * conductor on every turn of every class, so everything the conductor relies
 * on is checked here, before the first class, not discovered mid-lesson:
 *   - every field of the contract, the ranges its docblocks state (1–3
 *     points, 1–3 checks, 0–4 misconceptions, 1–3 alternates, 2–3 recap
 *     prompts), and 3–30 minutes, `formatVersion` 1, a whole-number `klass`,
 *     at least one idea and at least one worked-example step where there is a
 *     worked example; no blank strings, and no empty `nodeIds`;
 *   - ids: question, point and idea ids share ONE namespace across the whole
 *     plan, so a `heldQuestionId` or an `ideaId` on a move names exactly one
 *     thing; misconception ids are unique within their question (the same
 *     misconception may sit on several questions); and no id equals the id
 *     the conductor holds an idea's teach-back under (`teachBackId`);
 *   - the board: every `beatId`, and every `focus` element id, exists in the
 *     board lesson — checked only when the caller passes those sets;
 *   - leaks: no hint, misconception follow-up, misconception reason,
 *     alternate or worked-example step of a question gives away that
 *     question's `expect` or `answer` under `leaks()`, and no hint, follow-up
 *     or alternate holds the `answer` as written (`holdsAnswer`). All of
 *     these are said while the question is still held.
 *
 * NOT CHECKED, so nobody reads more into a pass: a paraphrase of an answer
 * (what `leaks()` cannot see); a question whose own words hold its answer, as
 * a choice question does ("with oxygen or without?"); and a point that states
 * its own quick question's answer, which the conductor allows by leaving that
 * secret out of that one move's `mustNotReveal`.
 *
 * Every problem is reported, not just the first, each as `path: what is
 * wrong`, so one pass over a model-written plan says everything to fix.
 */

export interface PlanCheckOptions {
  /** The board lesson's beat ids. Given, every idea's `board.beatId` must be one of them. */
  beatIds?: ReadonlySet<string>;
  /** The board lesson's element ids. Given, every id in an idea's `board.focus` must be one of them. */
  elementIds?: ReadonlySet<string>;
}

export type PlanCheck = { ok: true; plan: TeachingPlan } | { ok: false; problems: string[] };

const MODES: readonly AlternateMode[] = ['analogy', 'everyday', 'visual', 'steps'];

/**
 * The id an idea's teach-back is held under. A teach-back is not one of the
 * plan's questions, but the conductor holds it like one (so the reply can be
 * read against its `expect`), and evidence from it is filed under this id.
 */
export function teachBackId(ideaId: string): string {
  return `${ideaId}#teach-back`;
}

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const filled = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

export function validatePlan(plan: unknown, opts: PlanCheckOptions = {}): PlanCheck {
  const problems: string[] = [];
  if (!isObj(plan)) return { ok: false, problems: ['plan: must be an object'] };

  const c = new Checker(problems);

  if (plan.formatVersion !== 1) problems.push('formatVersion: must be 1');
  for (const field of ['id', 'topicRef', 'title', 'subject', 'boardLessonId'] as const) {
    c.text(field, plan[field]);
  }
  if (typeof plan.klass !== 'number' || !Number.isInteger(plan.klass) || plan.klass < 1) {
    problems.push('klass: must be a whole number, 1 or more');
  }
  if (typeof plan.minutes !== 'number' || !Number.isFinite(plan.minutes) || plan.minutes < 3 || plan.minutes > 30) {
    problems.push('minutes: must be a number from 3 to 30');
  }

  c.question('opener', plan.opener);

  const ideaIds: string[] = [];
  c.list('ideas', plan.ideas, 1, Infinity)?.forEach((idea, i) => {
    const at = `ideas[${i}]`;
    if (!isObj(idea)) {
      problems.push(`${at}: must be an object`);
      return;
    }
    if (c.text(`${at}.id`, idea.id)) {
      c.claim(idea.id, at);
      ideaIds.push(idea.id);
    }
    c.text(`${at}.title`, idea.title);
    c.texts(`${at}.nodeIds`, idea.nodeIds, 1, Infinity);
    c.board(`${at}.board`, idea.board, opts);
    if (idea.predict !== undefined) c.question(`${at}.predict`, idea.predict);

    c.list(`${at}.points`, idea.points, 1, 3)?.forEach((point, j) => {
      const pat = `${at}.points[${j}]`;
      if (!isObj(point)) {
        problems.push(`${pat}: must be an object`);
        return;
      }
      if (c.text(`${pat}.id`, point.id)) c.claim(point.id, pat);
      c.text(`${pat}.say`, point.say);
      c.question(`${pat}.ask`, point.ask);
    });

    c.list(`${at}.check`, idea.check, 1, 3)?.forEach((q, j) => c.question(`${at}.check[${j}]`, q));

    if (!isObj(idea.teachBack)) {
      problems.push(`${at}.teachBack: must be an object`);
    } else {
      c.text(`${at}.teachBack.prompt`, idea.teachBack.prompt);
      c.text(`${at}.teachBack.expect`, idea.teachBack.expect);
    }
  });

  if (!isObj(plan.recap)) {
    problems.push('recap: must be an object');
  } else {
    c.texts('recap.prompts', plan.recap.prompts, 2, 3);
  }
  c.texts('facts', plan.facts, 0, Infinity);
  c.texts('sources', plan.sources, 0, Infinity);

  // Checked last, once every id in the plan has been claimed.
  for (const id of ideaIds) {
    const held = teachBackId(id);
    if (c.ids.has(held)) {
      problems.push(`${c.ids.get(held)}.id: "${held}" is the id idea "${id}"'s teach-back is held under`);
    }
  }

  return problems.length === 0 ? { ok: true, plan: plan as unknown as TeachingPlan } : { ok: false, problems };
}

class Checker {
  /** Every question, point and idea id seen, and where it was first seen. */
  readonly ids = new Map<string, string>();

  constructor(private readonly problems: string[]) {}

  text(at: string, v: unknown): v is string {
    if (filled(v)) return true;
    this.problems.push(`${at}: must be a non-empty string`);
    return false;
  }

  /** The list, or null when it is not one. A count out of range is reported, and the items still checked. */
  list(at: string, v: unknown, min: number, max: number): unknown[] | null {
    if (!Array.isArray(v)) {
      this.problems.push(`${at}: must be a list`);
      return null;
    }
    if (v.length < min || v.length > max) {
      const want = max === Infinity ? `at least ${min}` : min === max ? `${min}` : `${min} to ${max}`;
      this.problems.push(`${at}: must have ${want} item(s), has ${v.length}`);
    }
    return v;
  }

  texts(at: string, v: unknown, min: number, max: number): void {
    this.list(at, v, min, max)?.forEach((item, i) => this.text(`${at}[${i}]`, item));
  }

  claim(id: string, at: string): void {
    const first = this.ids.get(id);
    if (first !== undefined) {
      this.problems.push(`${at}.id: "${id}" is already used at ${first}; ids must be unique across the plan`);
      return;
    }
    this.ids.set(id, at);
  }

  board(at: string, v: unknown, opts: PlanCheckOptions): void {
    if (!isObj(v)) {
      this.problems.push(`${at}: must be an object`);
      return;
    }
    if (this.text(`${at}.beatId`, v.beatId) && opts.beatIds && !opts.beatIds.has(v.beatId)) {
      this.problems.push(`${at}.beatId: "${v.beatId}" is not a beat of the board lesson`);
    }
    if (v.focus === undefined) return;
    this.list(`${at}.focus`, v.focus, 0, Infinity)?.forEach((id, i) => {
      if (this.text(`${at}.focus[${i}]`, id) && opts.elementIds && !opts.elementIds.has(id)) {
        this.problems.push(`${at}.focus[${i}]: "${id}" is not an element of the board lesson`);
      }
    });
  }

  question(at: string, v: unknown): void {
    if (!isObj(v)) {
      this.problems.push(`${at}: must be a question object`);
      return;
    }
    if (this.text(`${at}.id`, v.id)) this.claim(v.id, at);
    for (const field of ['question', 'expect', 'answer', 'why', 'hint'] as const) this.text(`${at}.${field}`, v[field]);

    const secrets = [v.expect, v.answer].filter(filled).map((s) => s.trim());
    const answer = filled(v.answer) ? v.answer : undefined;
    // `keyTerm`: also refused for holding the answer as written (see `holdsAnswer`).
    const guard = (where: string, t: unknown, keyTerm: boolean) => {
      if (!filled(t)) return;
      if (keyTerm && answer !== undefined && holdsAnswer(t, answer)) {
        this.problems.push(`${where}: contains the answer "${answer.trim()}"`);
        return;
      }
      const leaked = secrets.find((s) => leaks(t, [s]));
      if (leaked !== undefined) this.problems.push(`${where}: gives away the answer ("${leaked}")`);
    };

    guard(`${at}.hint`, v.hint, true);

    const seen = new Set<string>();
    this.list(`${at}.misconceptions`, v.misconceptions, 0, 4)?.forEach((m, i) => {
      const mat = `${at}.misconceptions[${i}]`;
      if (!isObj(m)) {
        this.problems.push(`${mat}: must be an object`);
        return;
      }
      if (this.text(`${mat}.id`, m.id)) {
        if (seen.has(m.id)) this.problems.push(`${mat}.id: "${m.id}" is used twice in this question`);
        seen.add(m.id);
      }
      for (const field of ['soundsLike', 'why', 'followUp'] as const) this.text(`${mat}.${field}`, m[field]);
      guard(`${mat}.followUp`, m.followUp, true);
      // Said once the misconception has been probed, before the question is asked again.
      guard(`${mat}.why`, m.why, false);
    });

    this.list(`${at}.alternates`, v.alternates, 1, 3)?.forEach((a, i) => {
      const aat = `${at}.alternates[${i}]`;
      if (!isObj(a)) {
        this.problems.push(`${aat}: must be an object`);
        return;
      }
      if (!MODES.includes(a.mode as AlternateMode)) this.problems.push(`${aat}.mode: must be one of ${MODES.join(', ')}`);
      if (this.text(`${aat}.say`, a.say)) guard(`${aat}.say`, a.say, true);
    });

    if (v.workedExample !== undefined) {
      const wat = `${at}.workedExample`;
      if (!isObj(v.workedExample)) {
        this.problems.push(`${wat}: must be an object`);
      } else {
        this.list(`${wat}.steps`, v.workedExample.steps, 1, Infinity)?.forEach((step, i) => {
          const sat = `${wat}.steps[${i}]`;
          if (!isObj(step)) {
            this.problems.push(`${sat}: must be an object`);
            return;
          }
          if (this.text(`${sat}.say`, step.say)) guard(`${sat}.say`, step.say, false);
          if (this.text(`${sat}.line`, step.line)) guard(`${sat}.line`, step.line, false);
        });
      }
    }

    this.texts(`${at}.nodeIds`, v.nodeIds, 1, Infinity);
  }
}

/**
 * The answer as written, found in `text` whole and case-insensitively, at word
 * boundaries (so an answer "yes" is not found in "eyes").
 *
 * The plain check, beside `leaks()`: it names the answer as the plan spells
 * it. `leaks()` compares token runs after its own normalisation — joining
 * words dropped, number words turned into digits — so it also catches "seven"
 * for "7", and it catches most of what this does. The cases found here and
 * not there: an answer `leaks()` reduces to no tokens at all (only joining
 * words like "is" or "to", or punctuation), and a number the text runs on
 * into a larger one ("7" in "7.5", "twenty" in "twenty-one").
 */
function holdsAnswer(text: string, answer: string): boolean {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const needle = norm(answer);
  if (needle.length === 0) return false;
  const hay = norm(text);
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : hay[at - 1];
    const after = hay[at + needle.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    from = at + 1;
  }
}
