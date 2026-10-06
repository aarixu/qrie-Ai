import type { Instruction, ScriptBeat } from '@ai-tutor/board-layout';
import { SPOKEN_MS_PER_CHAR, toolDurationMs } from '@ai-tutor/lesson-format';
import type { VisualBrief } from './types.ts';

/**
 * A BEAT WRITTEN AS ONE NARRATION, WRITTEN AGAIN AS LINES (board composer).
 *
 * The prompt asks for a beat as `say` lines with the board between them, and
 * the first real composed class (small intestine, 2026-10-06) came back with
 * every beat as one `narration` and no line at all. A beat with no line is one
 * moment: its whole page arrives at once, the camera frames the whole page, and
 * on a phone its writing was 10–11 px. So each sentence becomes a line, and
 * each thing on the board goes under the sentence that talks about it — found
 * by the words they share, never moved ahead of anything the planner wrote
 * before it.
 *
 * The title stays above the first line. An ask is held on the question it asks
 * or, asked in other words, on the last sentence. What the board writes after an
 * ask goes under a later line when there is one, so it arrives after the
 * answer; when the ask is held on the last line it waits for the answer with no
 * line of its own, as it did in the one narration, and the keep gate's
 * `unspoken` rule names it. The summary lands on the last line that is not a
 * question, no later than the next ask's. A moving tool gets a line as long as
 * it draws. A thing that shares no word with any later sentence stays under the
 * line it follows.
 */

/** A piece ending in one of these did not end its sentence: "Dr. Rao", "e.g. sugars". */
const ABBREVIATION = /(?:^|[\s(])(?:dr|mr|mrs|ms|prof|st|vs|etc|e\.g|i\.e|approx|fig|no)\.$/i;

/** Sentences of a narration: split after . ! or ?, and at a blank line. */
export function sentencesOf(narration: string): string[] {
  const pieces = narration
    .split(/\n\s*\n/)
    .flatMap((paragraph) => paragraph.trim().split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const raw: string[] = [];
  for (const piece of pieces) {
    const before = raw[raw.length - 1];
    if (before !== undefined && ABBREVIATION.test(before)) raw[raw.length - 1] = `${before} ${piece}`;
    else raw.push(piece);
  }
  // A greeting or an aside of a word or two is said with the sentence after it:
  // "Hello!" alone is a moment with nothing to show.
  const out: string[] = [];
  let carry = '';
  for (const s of raw) {
    const joined = carry ? `${carry} ${s}` : s;
    if (words(joined).length < SHORTEST) {
      carry = joined;
      continue;
    }
    out.push(joined);
    carry = '';
  }
  if (carry) {
    if (out.length > 0) out[out.length - 1] = `${out[out.length - 1]} ${carry}`;
    else out.push(carry);
  }
  return out;
}

/** A sentence shorter than this many words is said with the next one. */
const SHORTEST = 3;

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '');

/** Words that say nothing about WHICH thing a sentence is about. */
const STOP = new Set(
  (
    'the and for are but not you your yours this that these those with from into onto over under then than ' +
    'was were been being have has had its it’s our ours their there here what when where which who whom why how ' +
    'all any each every some more most much many very just also only even such can could will would should ' +
    'may might must does did doing done let lets let’s now see look think know about after before again ' +
    'one two three four five first second next last way thing things like make makes made get gets got ' +
    'hai hain kya aur toh bhi nahi ' +
    'yeh woh hum ab'
  ).split(/\s+/),
);

/** A word cut to its stem: "capillaries" and "capillary" meet, "villus" and "villi" too. */
function stem(word: string): string {
  return word.replace(/(?:ies)$/, 'y').replace(/(?:ing|ed|es|s|ly)$/, '');
}

function stemsOf(text: string): string[] {
  return [...new Set(words(text).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))];
}

/** Two stems are one word when one starts the other, or they share four letters out of five. */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (short < 4) return false;
  let n = 0;
  while (n < short && a[n] === b[n]) n += 1;
  return n === short || n >= Math.max(4, Math.ceil(short * 0.8));
}

/** The words a board instruction puts on the board, or points at. */
function wordsOf(step: Instruction, briefs: ReadonlyMap<string, VisualBrief>): string {
  const partOf = (target: string): string => target.split('#').slice(1).join(' ');
  switch (step.do) {
    case 'picture':
    case 'diagram': {
      const brief = briefs.get(step.ref);
      return brief ? `${brief.alt} ${brief.parts.join(' ')}` : step.ref.replace(/[_-]+/g, ' ');
    }
    case 'label':
      return `${step.text} ${partOf(step.target)}`;
    case 'annotate':
      return `${partOf(step.target) || step.target} ${step.span ?? ''}`;
    case 'point':
      return step.part;
    case 'sketch':
      return `${step.ref.replace(/[_-]+/g, ' ')} ${partOf(step.from)}`;
    case 'card':
      return `${step.heading} ${step.body}`;
    case 'list':
      return [step.heading ?? '', ...step.items.flatMap((i) => [i.term, i.meaning ?? ''])].join(' ');
    case 'flow':
      return step.steps.flatMap((s) => [s.label, s.note ?? '']).join(' ');
    case 'chart':
      return [step.caption ?? '', ...step.data.map((d) => d.label)].join(' ');
    case 'plot':
      return [step.caption ?? '', step.x ?? '', step.y ?? ''].join(' ');
    case 'place':
      return `${step.noun} ${step.label ?? ''}`;
    case 'connect':
      return `${step.label ?? ''} ${step.from} ${step.to}`;
    case 'compare':
      return [step.left.heading, ...step.left.points, step.right.heading, ...step.right.points].join(' ');
    case 'derive':
      return step.steps.join(' ');
    case 'ask':
      return step.question;
    case 'title':
    case 'write':
    case 'note':
    case 'caption':
    case 'summary':
    case 'equation':
      return step.text;
    case 'newPage':
    case 'say':
      return '';
    default:
      // A toolkit instruction carries its words in its own params.
      return Object.entries(step as unknown as Record<string, unknown>)
        .filter(([key, value]) => key !== 'do' && typeof value === 'string')
        .map(([, value]) => value as string)
        .join(' ');
  }
}

/**
 * Which sentence, from `from` on, an instruction belongs under: the one that
 * shares the most of its words, a word every sentence has counting for less.
 * Null when it shares none with any of them.
 */
function bestFrom(
  stems: readonly string[],
  sentences: readonly string[][],
  from: number,
  only?: (n: number) => boolean,
): number | null {
  let best: number | null = null;
  let bestScore = 0;
  for (let n = from; n < sentences.length; n += 1) {
    if (only && !only(n)) continue;
    let score = 0;
    for (const s of stems) {
      if (!sentences[n].some((w) => same(w, s))) continue;
      const spread = sentences.filter((sentence) => sentence.some((w) => same(w, s))).length;
      score += 1 / spread;
    }
    if (score > bestScore) {
      best = n;
      bestScore = score;
    }
  }
  return best;
}

/** The first sentence, from `from` on, that shares any of its words. */
function firstFrom(
  stems: readonly string[],
  sentences: readonly string[][],
  from: number,
  only?: (n: number) => boolean,
): number | null {
  for (let n = from; n < sentences.length; n += 1) {
    if (only && !only(n)) continue;
    if (stems.some((s) => sentences[n].some((w) => same(w, s)))) return n;
  }
  return null;
}

/**
 * Writing and marks: each goes under the sentence that says most of it. Every
 * other instruction is a demonstration — a picture, a scene, a flow, a table,
 * working, a toolkit figure — and arrives when its subject is first spoken of.
 */
const WRITING: ReadonlySet<string> = new Set([
  'write',
  'label',
  'annotate',
  'point',
  'card',
  'note',
  'list',
  'caption',
  'summary',
  'equation',
  'connect',
  'sketch',
]);

/** How long a moving tool draws, or null for anything that is not one (lesson-format's own clock). */
function toolMs(step: Instruction): number | null {
  const { do: tool, id: _id, at: _at, ...params } = step as unknown as Record<string, unknown>;
  return toolDurationMs(tool, params);
}

/**
 * A MOVING TOOL GETS A LINE AS LONG AS IT DRAWS (the keep gate's
 * tool-fits-line: about 14 characters a second, plus half a second).
 *
 * One narration was one long line, so working that moves step by step always
 * had time to finish. Under one sentence it may not, and the class would be
 * refused for it. So the sentences after the tool's are said with it until the
 * line is long enough, then the ones before — never one that holds another
 * tool, never past an ask the tool's line is held on, and never one before that
 * holds an ask.
 */
function giveToolsTheirTime(lines: { text: string; under: Instruction[] }[]): void {
  const lineMs = (text: string): number => text.length * SPOKEN_MS_PER_CHAR + 500;
  const needs = (ink: readonly Instruction[]): number => Math.max(0, ...ink.map((s) => toolMs(s) ?? 0));
  const hasTool = (ink: readonly Instruction[]): boolean => ink.some((s) => toolMs(s) !== null);
  const asks = (ink: readonly Instruction[]): boolean => ink.some((s) => s.do === 'ask');
  for (let k = 0; k < lines.length; k += 1) {
    const want = needs(lines[k].under);
    if (want === 0) continue;
    while (lineMs(lines[k].text) < want && k + 1 < lines.length && !asks(lines[k].under) && !hasTool(lines[k + 1].under)) {
      const next = lines.splice(k + 1, 1)[0];
      lines[k] = { text: `${lines[k].text} ${next.text}`, under: [...lines[k].under, ...next.under] };
    }
    while (lineMs(lines[k].text) < want && k > 0 && !asks(lines[k - 1].under) && !hasTool(lines[k - 1].under)) {
      const before = lines.splice(k - 1, 1)[0];
      k -= 1;
      lines[k] = { text: `${before.text} ${lines[k].text}`, under: [...before.under, ...lines[k].under] };
    }
  }
}

/**
 * Write every beat that has a narration of two or more sentences and no `say`
 * as lines, in place. Returns how many beats it wrote again.
 */
export function splitNarrations(beats: ScriptBeat[], visuals: readonly VisualBrief[]): number {
  const briefs = new Map(visuals.map((v) => [v.id, v]));
  let split = 0;
  for (const beat of beats) {
    if (beat.board.some((step) => step.do === 'say')) continue;
    const sentences = sentencesOf(beat.narration ?? '');
    if (sentences.length < 2) continue;
    const said = sentences.map(stemsOf);
    const asking = (n: number): boolean => sentences[n].trimEnd().endsWith('?');

    const last = sentences.length - 1;
    const range = (from: number, to: number): number[] =>
      Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k);

    /**
     * Each ask first, on the question it asks — failing that on the last
     * sentence, where a beat of one narration always asked it — because
     * everything the planner wrote before an ask must arrive by the line it is
     * held on, and everything after it under a later line. Not on just any
     * question: a hook ("Why is the intestine so long?") said before the
     * teaching is not the question the class stops on, and held there, the
     * whole page arrived with the hook and the ask came before the teaching.
     */
    const heldAt = new Map<number, number>();
    let askFloor = 0;
    beat.board.forEach((step, index) => {
      if (step.do !== 'ask') return;
      const n = Math.max(bestFrom(stemsOf(step.question), said, askFloor, asking) ?? last, askFloor);
      heldAt.set(index, n);
      askFloor = Math.min(n + 1, last);
    });

    const early: Instruction[] = [];
    const under: Instruction[][] = sentences.map(() => []);
    /** No thing goes under an earlier line than the thing before it. */
    let floor = 0;

    beat.board.forEach((step, index) => {
      if (step.do === 'title' && floor === 0 && under[0].length === 0) {
        early.push(step);
        return;
      }
      const held = heldAt.get(index);
      if (held !== undefined) {
        under[held].push(step);
        // What follows the ask waits for a line after the one it is held on.
        floor = Math.min(held + 1, last);
        return;
      }
      // And arrives no later than the line the next ask is held on.
      const nextAsk = [...heldAt].find(([at]) => at > index)?.[1];
      const ceiling = nextAsk === undefined ? last : Math.max(nextAsk, floor);
      const stems = stemsOf(wordsOf(step, briefs));
      let n: number;
      if (step.do === 'summary') {
        // The point the beat lands on: its last line that is not a question,
        // no later than the line the next ask is held on.
        const statements = range(floor, ceiling).filter((k) => !asking(k));
        n = statements[statements.length - 1] ?? floor;
      } else {
        const exact = step.do === 'write' || step.do === 'equation' ? step.at : undefined;
        const spoken = exact
          ? range(floor, ceiling).find((k) => words(sentences[k]).includes(exact.toLowerCase()))
          : undefined;
        const within = (k: number): boolean => k <= ceiling;
        // A demonstration arrives when its subject is first spoken of; a piece
        // of writing under the sentence that says most of it.
        const find = WRITING.has(step.do) ? bestFrom : firstFrom;
        n = spoken ?? find(stems, said, floor, within) ?? floor;
      }
      n = Math.min(Math.max(n, floor), ceiling);
      under[n].push(step);
      floor = n;
    });

    const lines = sentences.map((text, n) => ({ text, under: under[n] }));
    giveToolsTheirTime(lines);
    beat.board = [...early, ...lines.flatMap(({ text, under: ink }) => [{ do: 'say' as const, text }, ...ink])];
    // Said once: the lines are what is spoken, and a narration left beside them
    // is a second copy of every sentence in the repair prompt, never spoken.
    beat.narration = '';
    split += 1;
  }
  return split;
}
