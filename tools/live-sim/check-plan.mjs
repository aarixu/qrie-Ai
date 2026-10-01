/**
 * THE TEACHING PLAN'S SELF-CHECK: what can be checked about a plan without a
 * model, before it is committed.
 *
 * A plan (TeachingPlan, packages/tutor-control/src/conductor/types.ts) is
 * hand-authored JSON, and TypeScript cannot check it: a JSON import widens
 * `formatVersion` to number and `mode` to string, so the file cannot be typed
 * as a TeachingPlan without a cast, and behind a cast a misspelt key or a beat
 * the board does not have would surface only in a live class. This script is
 * where those mistakes are caught instead.
 *
 * WHAT IT CHECKS
 *   - Shape: every field the type requires, of the right kind, and no key the
 *     type does not have; every idea has a prediction (the brief: ask before
 *     telling).
 *   - Counts: the type's own bounds, tightened to the lab's authoring rules
 *     (RULES below).
 *   - Ids: lower-case kebab, and unique across the whole plan: ideas, points,
 *     questions and misconceptions share one namespace.
 *   - The board: each idea's beat exists in the board lesson, and every focus
 *     id is an element that beat shows.
 *   - Outcomes: every node id exists in the knowledge graph and belongs to the
 *     plan's topicRef; a node of that topic that nothing in the plan claims is
 *     a warning.
 *   - Leaks: no hint, follow-up, misconception reason, alternate or worked
 *     step (each alone, and a worked example's steps together) contains its
 *     own question's answer or expect, by the conductor package's own leak
 *     check (`leaks`, packages/tutor-control/src/leak.ts), and none carries
 *     every key term of a short answer (see keyTerms).
 *   - One move: the reason and the answer given for one question are said in
 *     the same move that asks the next one, so neither may give that next
 *     question's answer away (see sameMove).
 *   - Text: questions, hints and follow-ups end in a question mark; a hint and
 *     a follow-up are ONE question; a point's say is 1-2 sentences and its ask
 *     one; the opener, a prediction, a check and a teach-back prompt are
 *     within their move's cap (RULES.questionSentences); a fact is one
 *     sentence; no markdown, no
 *     Devanagari; at least one source gives a URL.
 *
 * WHAT IT DOES NOT CHECK, so nobody reads more into a pass:
 *   - whether the content is TRUE. That is the author's job, against the
 *     sources the plan cites;
 *   - a paraphrased leak ("the powerhouse" for "the mitochondria"): `leaks`
 *     matches whole-token runs only, and keyTerms folds only plural and tense
 *     endings (see fold), so "cramp" matches "cramps" but "pile up" does not
 *     match "builds up";
 *   - a misconception's reason that states the conclusion of a yes/no
 *     question in other words ("so the first step cannot depend on oxygen"):
 *     the question is asked again after it, and only a reader can tell;
 *   - the board: an idea's scene is shown whole, notes included, and a note
 *     may state a prediction's or a check's answer. One board per idea is all
 *     the plan can say; hiding notes while a question is held is the
 *     conductor's and the lab screen's job;
 *   - the every-key-term rule on an answer with more than RULES.keyTermsMax
 *     key terms, where it is skipped rather than guess which of them matter.
 *
 * Run: node tools/live-sim/check-plan.mjs [plan.json] [--notes]
 * Exits 1 on any error. `--notes` also lists the overlaps that are not errors
 * (a point's say that states its own ask's answer, a line that uses some key
 * terms of the answer), for a human to read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leaks, leakTokens } from '../../packages/tutor-control/src/leak.ts';

// path.dirname(fileURLToPath(...)), not `new URL(template, import.meta.url)`:
// the same reason as tools/prewarm/lib/topics.mjs — vite, which runs this
// file under vitest, rewrites that URL pattern.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');

export const DEFAULT_PLAN = 'content/plans/class10-respiration.json';

/**
 * The lab's authoring rules, as [min, max]. Where the type states a bound
 * (points 1-3, check 1-3, misconceptions 0-4, alternates 1-3), these sit
 * inside it; `check` is exactly two because the second is the fresh retest
 * question the first one's help calls for.
 */
export const RULES = {
  ideas: [3, 6],
  points: [1, 2],
  check: [2, 2],
  misconceptions: [0, 3],
  alternates: [1, 2],
  recapPrompts: [2, 3],
  facts: [10, 16],
  /** lesson-format's validator allows a worked example 1 to 6 steps. */
  workedSteps: [1, 6],
  pointSaySentences: [1, 2],
  /**
   * The most sentences a question may have on its own, by the move that asks
   * it. These are the talk caps (Move.maxSentences) the conductor built for
   * this lab starts each kind of move from: 3 for the opening move, 2 for a
   * prediction, a check and a teach-back (its capOf, on the conductor's
   * branch; UNVERIFIED in this tree, where that conductor is not merged). A
   * question within its move's cap leaves that move short even before the
   * reason for the last answer is added to it.
   */
  questionSentences: { opener: 3, predict: 2, check: 2, teachBack: 2 },
  /** A spoken sentence longer than this is a warning: the brief is short sentences. */
  maxSentenceWords: 32,
  /** keyTerms is skipped for an answer with more key terms than this. */
  keyTermsMax: 4,
};

const ALTERNATE_MODES = new Set(['analogy', 'everyday', 'visual', 'steps']);

/** Keys of each object in the type, split into required and optional. */
const SHAPES = {
  plan: {
    required: [
      'formatVersion',
      'id',
      'topicRef',
      'title',
      'klass',
      'subject',
      'boardLessonId',
      'minutes',
      'opener',
      'ideas',
      'recap',
      'facts',
      'sources',
    ],
    optional: [],
  },
  question: {
    required: ['id', 'question', 'expect', 'answer', 'why', 'hint', 'misconceptions', 'alternates', 'nodeIds'],
    optional: ['workedExample'],
  },
  misconception: { required: ['id', 'soundsLike', 'why', 'followUp'], optional: [] },
  alternate: { required: ['mode', 'say'], optional: [] },
  workedExample: { required: ['steps'], optional: [] },
  step: { required: ['say', 'line'], optional: [] },
  point: { required: ['id', 'say', 'ask'], optional: [] },
  idea: {
    required: ['id', 'title', 'nodeIds', 'board', 'points', 'check', 'teachBack'],
    optional: ['predict'],
  },
  board: { required: ['beatId'], optional: ['focus'] },
  teachBack: { required: ['prompt', 'expect'], optional: [] },
  recap: { required: ['prompts'], optional: [] },
};

/**
 * Words that carry no answer on their own, dropped before key terms are
 * compared: articles, pronouns, prepositions, auxiliaries, and the commonest
 * verbs. `yes` and `no` are here because a yes/no answer's word is not a leak
 * by itself: every alternate may say "no" in passing.
 */
const STOP = new Set(
  (
    'a an the and or but of in on at by for from with without within through about after before around again ' +
    'as it its this that these those they them their there then than so because which what when where who why ' +
    'how do does did done be been being are was were has have had not no yes your you our we us me my he she ' +
    'his her all any each every some much more most less very only also just still even while whose into out ' +
    'up down over off go goes going come comes came get gets got make makes made give gives gave can could ' +
    'would will should may might one way ways thing things'
  ).split(' '),
);

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

/** Sentences as a listener hears them: split after . ! or ? before a capital, digit or bracket. */
export function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * A token with its plural or tense ending taken off, so the key-term rule
 * hears "cramp" in "cramps" and "caused" in "causes": a trailing -ing, else
 * -ed, else -es, else -s (not -ss), then a trailing -e. Crude on purpose, and
 * it errs toward missing: "used" and "use" stay apart, as do "ran" and "run".
 * Two different words can fold alike ("lines", "lined"); in a key-term
 * comparison that costs a note, never a missed leak.
 */
export function fold(token) {
  let t = token;
  if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith('ed')) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith('es')) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith('e')) t = t.slice(0, -1);
  return t;
}

const folded = (text) => new Set(leakTokens(text).map(fold));

/**
 * The words a right answer turns on: tokens the answer AND the expect both
 * use, that the question itself does not already say, minus STOP and single
 * characters (the "s" of "sprinter's"), compared after `fold`. An answer and
 * expect that are both "In the mitochondria." give [mitochondria]; "Lactic
 * acid. When it builds up in the muscles, it causes cramps." against its
 * expect "Lactic acid, whose build-up causes cramps." and the question "What
 * do your muscle cells make when they run short of oxygen, and what does it
 * cause?" gives [lactic, acid, builds, cramps]: "causes" is dropped because
 * the question already says "cause". Both are pinned in
 * tools/live-sim/tests/check-plan.test.ts.
 */
export function keyTerms(q) {
  const asked = folded(q.question);
  const expected = folded(q.expect);
  const seen = new Set();
  return leakTokens(q.answer).filter((t) => {
    const f = fold(t);
    if (t.length <= 1 || STOP.has(t) || seen.has(f) || !expected.has(f) || asked.has(f)) return false;
    seen.add(f);
    return true;
  });
}

/** Every graph node in packages/knowledge-graph/data, by id. Probe files are not graphs. */
export function loadGraphNodes() {
  const dir = path.join(REPO, 'packages/knowledge-graph/data');
  const nodes = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file.endsWith('.probes.json')) continue;
    const graph = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const node of graph.nodes ?? []) nodes.set(node.id, node);
  }
  return nodes;
}

/**
 * The plan and what it is checked against: its board lesson
 * (content/<boardLessonId>/lesson.json, null when there is none) and the
 * knowledge graph. Relative paths are from the repo root, not the caller's
 * working directory.
 */
export function loadPlanContext(planPath = DEFAULT_PLAN) {
  const file = path.resolve(REPO, planPath);
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lessonFile =
    typeof plan?.boardLessonId === 'string'
      ? path.join(REPO, 'content', plan.boardLessonId, 'lesson.json')
      : null;
  const lesson = lessonFile && fs.existsSync(lessonFile) ? JSON.parse(fs.readFileSync(lessonFile, 'utf8')) : null;
  return { file, plan, context: { lesson, graph: loadGraphNodes() } };
}

/**
 * THE SAME MOVE: what is said for one question, in the move that asks the
 * next. On a right answer the reaction gives the question's `why` before the
 * move itself (Ack.why and Move.ack, packages/tutor-control/src/conductor/
 * types.ts), and the move ends with the next question; on a reveal she gives
 * the `answer` with its `why` (PlanQuestion.answer and .why there) and the
 * class moves on. Either way the next question is asked in the same breath,
 * before the student has said a word to it, so each such line is held to the
 * next question by `guard`, as a hint is to its own.
 *
 * The pairs, in order: the opener's why with the first idea's first
 * question; in each idea, the prediction's why with the first point's ask,
 * each ask's why and answer with the next ask, and the last ask's with
 * check[0]. check[0]'s go with the teach-back, which has no answer to give
 * away. Two more come from the conductor built for this lab (on its own
 * branch; UNVERIFIED in this tree, where it is not merged): a retest, one of
 * an idea's later checks (check[1] on), is asked after the NEXT idea's
 * points, so that idea's last ask's lines go with the retest and the
 * retest's with that idea's check[0]; and a teach-back that misses gives the
 * idea's first point, which then goes with the next idea's first question. A
 * retest with no idea after it comes before the recap and is not paired.
 *
 * @param {any} opener
 * @param {any[]} ideas
 * @param {(line: unknown, q: any, where: string) => void} guard
 */
export function sameMove(opener, ideas, guard) {
  if (!Array.isArray(ideas)) return;
  /** What the move after `q` may carry: its why, and on a reveal a graded question's answer. */
  const lines = (q, at, graded) => {
    if (!isObject(q)) return [];
    const out = [[q.why, `${at}.why`]];
    if (graded) out.push([q.answer, `${at}.answer`]);
    return out.filter(([t]) => isText(t));
  };
  const pair = (carried, next, nextAt) => {
    if (!isObject(next)) return;
    for (const [line, where] of carried) guard(line, next, `${where}, said in the move that asks ${nextAt}`);
  };
  const pointsOf = (idea) => (isObject(idea) && Array.isArray(idea.points) ? idea.points : []).filter(isObject);
  const checksOf = (idea) => (isObject(idea) && Array.isArray(idea.check) ? idea.check : []);

  let carried = lines(opener, 'opener', false);
  ideas.forEach((idea, n) => {
    const at = `ideas[${n}]`;
    if (!isObject(idea)) {
      carried = [];
      return;
    }
    if (isObject(idea.predict)) {
      pair(carried, idea.predict, `${at}.predict`);
      carried = lines(idea.predict, `${at}.predict`, false);
    }
    pointsOf(idea).forEach((p, i) => {
      pair(carried, p.ask, `${at}.points[${i}].ask`);
      carried = lines(p.ask, `${at}.points[${i}].ask`, true);
    });
    const check0 = checksOf(idea)[0];
    if (n > 0) {
      checksOf(ideas[n - 1]).forEach((retest, k) => {
        if (k === 0 || !isObject(retest)) return;
        const rat = `ideas[${n - 1}].check[${k}]`;
        pair(carried, retest, rat);
        pair(lines(retest, rat, true), check0, `${at}.check[0]`);
      });
    }
    pair(carried, check0, `${at}.check[0]`);
    const first = pointsOf(idea)[0];
    carried = first && isText(first.say) ? [[first.say, `${at}.points[0].say`]] : [];
  });
}

/**
 * Check one plan. Returns every problem found rather than stopping at the
 * first, so one run shows the whole list.
 *
 * @param {unknown} plan
 * @param {{ lesson: any, graph: Map<string, any> }} context
 */
export function checkPlan(plan, context) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const counts = { ideas: 0, questions: 0, facts: 0 };
  const err = (at, msg) => errors.push(`${at}: ${msg}`);

  const shape = (value, at, kind) => {
    if (!isObject(value)) {
      err(at, `must be an object (${kind})`);
      return false;
    }
    const { required, optional } = SHAPES[kind];
    for (const key of required) if (!(key in value)) err(at, `missing "${key}"`);
    for (const key of Object.keys(value)) {
      if (!required.includes(key) && !optional.includes(key)) err(at, `"${key}" is not a field of ${kind}`);
    }
    return true;
  };

  /** `spoken: false` for text nobody hears (sources), which skips the sentence-length warning. */
  const text = (value, at, { spoken = true } = {}) => {
    if (!isText(value)) {
      err(at, 'must be non-empty text');
      return false;
    }
    if (value !== value.trim() || /\s{2,}/.test(value)) err(at, 'stray whitespace');
    if (/[*_#`|<>[\]]/.test(value)) err(at, 'looks like markdown or markup; plans are plain text');
    if (/[ऀ-ॿ]/.test(value)) err(at, 'Devanagari; a plan is English and the language is applied live');
    if (!spoken) return true;
    for (const s of sentences(value)) {
      const words = s.split(/\s+/).length;
      if (words > RULES.maxSentenceWords) {
        warnings.push(`${at}: a ${words}-word sentence (over ${RULES.maxSentenceWords}): "${s.slice(0, 60)}…"`);
      }
    }
    return true;
  };

  const count = (arr, at, [min, max], what) => {
    if (!Array.isArray(arr)) {
      err(at, `must be a list of ${what}`);
      return false;
    }
    if (arr.length < min || arr.length > max) {
      err(at, `${arr.length} ${what}; the rule is ${min === max ? min : `${min} to ${max}`}`);
    }
    return true;
  };

  const oneQuestion = (value, at) => {
    if (!isText(value)) return;
    if (!value.trim().endsWith('?')) err(at, 'must end with a question mark');
    if ((value.match(/\?/g) ?? []).length !== 1) err(at, 'must be exactly one question');
  };

  // ---- ids: one namespace for the whole plan -------------------------------
  const seen = new Map();
  const id = (value, at) => {
    if (!isText(value)) {
      err(at, 'id must be non-empty text');
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) err(at, `id "${value}" is not lower-case kebab`);
    if (seen.has(value)) err(at, `id "${value}" is already used at ${seen.get(value)}`);
    else seen.set(value, at);
  };

  // ---- outcomes ------------------------------------------------------------
  const graph = context?.graph ?? new Map();
  const topicRef = isObject(plan) ? plan.topicRef : undefined;
  const claimed = new Set();
  const nodeIds = (value, at) => {
    if (!count(value, at, [1, Infinity], 'node ids')) return;
    for (const [i, nodeId] of value.entries()) {
      const node = graph.get(nodeId);
      if (!node) {
        err(`${at}[${i}]`, `"${nodeId}" is not a knowledge-graph node`);
        continue;
      }
      if (node.topicRef !== topicRef) {
        err(`${at}[${i}]`, `"${nodeId}" belongs to ${node.topicRef}, not this plan's ${topicRef}`);
      }
      claimed.add(nodeId);
    }
  };

  /**
   * A line said while `q` is open, or in the move that asks it, must not give
   * its answer away: not its answer or expect (`leaks`), and not every key
   * term of a short answer. Some key terms is a note.
   */
  const guard = (line, q, where) => {
    if (!isText(line) || !isObject(q)) return;
    if (leaks(line, [q.answer, q.expect].filter(isText))) err(where, `contains the answer or expect of ${q.id}`);
    const terms = isText(q.answer) && isText(q.expect) && isText(q.question) ? keyTerms(q) : [];
    if (terms.length === 0) return;
    const tokens = folded(line);
    const used = terms.filter((t) => tokens.has(fold(t)));
    if (used.length === terms.length && terms.length <= RULES.keyTermsMax) {
      err(where, `carries every key term of ${q.id}'s answer (${terms.join(', ')})`);
    } else if (used.length > 0) {
      notes.push(`${where}: uses ${used.join(', ')} of ${q.id}'s key terms (${terms.join(', ')})`);
    }
  };

  // ---- one question --------------------------------------------------------
  /** `kind`: the move that asks it, for its sentence cap (RULES.questionSentences); a point's ask is one sentence. */
  const question = (q, at, kind) => {
    if (!shape(q, at, 'question')) return;
    counts.questions += 1;
    id(q.id, `${at}.id`);
    for (const key of ['question', 'expect', 'answer', 'why', 'hint']) text(q[key], `${at}.${key}`);
    if (isText(q.question)) {
      if (!q.question.trim().endsWith('?')) err(`${at}.question`, 'must end with a question mark');
      const n = sentences(q.question).length;
      if (kind === 'point' && n !== 1) err(`${at}.question`, 'a point\'s ask is one sentence');
      const cap = RULES.questionSentences[kind];
      if (cap !== undefined && n > cap) err(`${at}.question`, `${n} sentences; a ${kind} move's cap is ${cap}`);
    }
    oneQuestion(q.hint, `${at}.hint`);
    nodeIds(q.nodeIds, `${at}.nodeIds`);

    const guarded = (line, where) => guard(line, q, where);
    guarded(q.hint, `${at}.hint`);

    if (count(q.misconceptions, `${at}.misconceptions`, RULES.misconceptions, 'misconceptions')) {
      q.misconceptions.forEach((m, i) => {
        const mat = `${at}.misconceptions[${i}]`;
        if (!shape(m, mat, 'misconception')) return;
        id(m.id, `${mat}.id`);
        for (const key of ['soundsLike', 'why', 'followUp']) text(m[key], `${mat}.${key}`);
        oneQuestion(m.followUp, `${mat}.followUp`);
        guarded(m.followUp, `${mat}.followUp`);
        // Said once the misconception has been probed (Ack.why in the
        // conductor's types), when the question may still be open, so it is
        // held to the same rule.
        guarded(m.why, `${mat}.why`);
      });
    }

    if (count(q.alternates, `${at}.alternates`, RULES.alternates, 'alternates')) {
      q.alternates.forEach((a, i) => {
        const aat = `${at}.alternates[${i}]`;
        if (!shape(a, aat, 'alternate')) return;
        if (!ALTERNATE_MODES.has(a.mode)) err(`${aat}.mode`, `"${a.mode}" is not an AlternateMode`);
        text(a.say, `${aat}.say`);
        guarded(a.say, `${aat}.say`);
      });
    }

    if (q.workedExample !== undefined && shape(q.workedExample, `${at}.workedExample`, 'workedExample')) {
      const steps = q.workedExample.steps;
      if (count(steps, `${at}.workedExample.steps`, RULES.workedSteps, 'steps')) {
        steps.forEach((s, i) => {
          const sat = `${at}.workedExample.steps[${i}]`;
          if (!shape(s, sat, 'step')) return;
          text(s.say, `${sat}.say`);
          text(s.line, `${sat}.line`);
          guarded(s.say, `${sat}.say`);
          guarded(s.line, `${sat}.line`);
        });
        // The steps are said one after another in one move, so an answer
        // spread across them is as given away as one inside a single step.
        const whole = steps.flatMap((s) => (isObject(s) ? [s.say, s.line] : [])).filter(isText).join(' ');
        guarded(whole, `${at}.workedExample (all steps together)`);
      }
    }
  };

  // ---- the plan ------------------------------------------------------------
  if (!shape(plan, 'plan', 'plan')) return { errors, warnings, notes, counts };

  if (plan.formatVersion !== 1) err('plan.formatVersion', 'must be 1');
  for (const key of ['id', 'topicRef', 'title', 'subject', 'boardLessonId']) text(plan[key], `plan.${key}`);
  if (!Number.isInteger(plan.klass) || plan.klass < 1 || plan.klass > 12) err('plan.klass', 'must be a class from 1 to 12');
  if (typeof plan.minutes !== 'number' || !(plan.minutes > 0)) err('plan.minutes', 'must be a positive number');

  const lesson = context?.lesson ?? null;
  const beats = new Map();
  const elements = new Set();
  if (!lesson) {
    err('plan.boardLessonId', `no board lesson content/${plan.boardLessonId}/lesson.json`);
  } else {
    if (lesson.id !== plan.boardLessonId) err('plan.boardLessonId', `the lesson file's id is "${lesson.id}"`);
    if (lesson.topicRef !== plan.topicRef) err('plan.topicRef', `the board lesson teaches ${lesson.topicRef}`);
    for (const beat of lesson.beats ?? []) beats.set(beat.id, beat);
    for (const el of lesson.elements ?? []) elements.add(el.id);
  }

  question(plan.opener, 'opener', 'opener');

  if (count(plan.ideas, 'ideas', RULES.ideas, 'ideas')) {
    plan.ideas.forEach((idea, n) => {
      const at = `ideas[${n}]`;
      if (!shape(idea, at, 'idea')) return;
      counts.ideas += 1;
      id(idea.id, `${at}.id`);
      text(idea.title, `${at}.title`);
      nodeIds(idea.nodeIds, `${at}.nodeIds`);

      if (shape(idea.board, `${at}.board`, 'board')) {
        text(idea.board.beatId, `${at}.board.beatId`);
        const beat = beats.get(idea.board.beatId);
        if (lesson && !beat) err(`${at}.board.beatId`, `"${idea.board.beatId}" is not a beat of ${plan.boardLessonId}`);
        if (idea.board.focus !== undefined && count(idea.board.focus, `${at}.board.focus`, [1, Infinity], 'element ids')) {
          for (const el of idea.board.focus) {
            if (lesson && !elements.has(el)) err(`${at}.board.focus`, `"${el}" is not an element of ${plan.boardLessonId}`);
            else if (beat && !(beat.show ?? []).includes(el)) {
              err(`${at}.board.focus`, `"${el}" is not shown by beat "${beat.id}"`);
            }
          }
        }
      }

      // The brief: every idea asks before it tells.
      if (idea.predict === undefined) err(`${at}.predict`, 'every idea opens with a prediction');
      else question(idea.predict, `${at}.predict`, 'predict');

      if (count(idea.points, `${at}.points`, RULES.points, 'points')) {
        idea.points.forEach((p, i) => {
          const pat = `${at}.points[${i}]`;
          if (!shape(p, pat, 'point')) return;
          id(p.id, `${pat}.id`);
          if (text(p.say, `${pat}.say`)) {
            const n = sentences(p.say).length;
            const [min, max] = RULES.pointSaySentences;
            if (n < min || n > max) err(`${pat}.say`, `${n} sentences; a point is ${min} to ${max}`);
          }
          question(p.ask, `${pat}.ask`, 'point');
          // Not an error: a comprehension ask is about what was just said. A
          // conductor that leak-checks an explain move against its own ask
          // needs to know which points state their ask's answer.
          if (isObject(p.ask) && isText(p.say) && leaks(p.say, [p.ask.answer, p.ask.expect].filter(isText))) {
            notes.push(`${pat}.say: states the answer of its own ask ${p.ask.id}`);
          }
        });
      }

      if (count(idea.check, `${at}.check`, RULES.check, 'checks')) {
        idea.check.forEach((q, i) => question(q, `${at}.check[${i}]`, 'check'));
        const asked = idea.check.map((q) => (isObject(q) ? q.question : undefined));
        if (new Set(asked).size !== asked.length) err(`${at}.check`, 'the retest must be a fresh question');
      }

      if (shape(idea.teachBack, `${at}.teachBack`, 'teachBack')) {
        if (text(idea.teachBack.prompt, `${at}.teachBack.prompt`)) {
          const n = sentences(idea.teachBack.prompt).length;
          const cap = RULES.questionSentences.teachBack;
          if (n > cap) err(`${at}.teachBack.prompt`, `${n} sentences; a teachBack move's cap is ${cap}`);
        }
        text(idea.teachBack.expect, `${at}.teachBack.expect`);
      }
    });
    sameMove(plan.opener, plan.ideas, guard);
  }

  if (shape(plan.recap, 'recap', 'recap') && count(plan.recap.prompts, 'recap.prompts', RULES.recapPrompts, 'prompts')) {
    plan.recap.prompts.forEach((p, i) => text(p, `recap.prompts[${i}]`));
  }

  if (count(plan.facts, 'facts', RULES.facts, 'facts')) {
    plan.facts.forEach((f, i) => {
      counts.facts += 1;
      if (text(f, `facts[${i}]`) && sentences(f).length !== 1) err(`facts[${i}]`, 'a fact is one sentence');
    });
  }

  if (count(plan.sources, 'sources', [1, Infinity], 'sources')) {
    plan.sources.forEach((s, i) => text(s, `sources[${i}]`, { spoken: false }));
    if (!plan.sources.some((s) => typeof s === 'string' && /https:\/\/\S+/.test(s))) {
      err('sources', 'no source gives a URL');
    }
  }

  // Every outcome of this topic should be taught somewhere; one that is not
  // is an outcome the class never gathers evidence on.
  for (const node of graph.values()) {
    if (node.topicRef === plan.topicRef && !claimed.has(node.id)) {
      warnings.push(`plan: no question or idea claims ${node.id} (${node.title})`);
    }
  }

  return { errors, warnings, notes, counts };
}

function main(argv) {
  const showNotes = argv.includes('--notes');
  const planPath = argv.find((a) => !a.startsWith('--')) ?? DEFAULT_PLAN;
  const { file, plan, context } = loadPlanContext(planPath);
  const { errors, warnings, notes, counts } = checkPlan(plan, context);

  console.log(`check-plan: ${path.relative(REPO, file).split(path.sep).join('/')}`);
  console.log(`  ${counts.ideas} ideas, ${counts.questions} questions, ${counts.facts} facts`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
  if (showNotes) for (const n of notes) console.log(`  NOTE  ${n}`);
  console.log(
    `  ${errors.length} errors, ${warnings.length} warnings, ${notes.length} notes${showNotes || notes.length === 0 ? '' : ' (--notes lists them)'}`,
  );
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
