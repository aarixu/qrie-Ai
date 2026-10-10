import type { Instruction, ScriptBeat } from '@ai-tutor/board-layout';
import { same, stemsOf } from './sayLines.ts';
import type { VisualBrief } from './types.ts';

/**
 * WHAT SHE TALKS ABOUT, SHE MARKS (Aarav, 2026-10-07: "har 1-2 line me jahan
 * jis diagram, text, image ya jis k baare me bhi tum baat kr rhe ho unko annote
 * kr skte hai").
 *
 * The prompt asks for marks and a model writes a few. So each line that does
 * not mark anything is given a mark on the thing it talks about, found by the
 * words they share: a part of a picture is circled (a diagram's part is lit),
 * a thing in the scene is circled, an item of a list is highlighted, and a key
 * point written on an earlier line is underlined. Never what this same line has
 * just placed or written — that
 * is new ink already — and never something marked on either of the two lines
 * before. A line with an ask keeps the ask last. Composed classes only.
 */

type Target =
  | { kind: 'part'; ref: string; part: string; words: string[]; line: number }
  | { kind: 'lit'; ref: string; part: string; words: string[]; line: number }
  | { kind: 'place'; id: string; words: string[]; line: number }
  | { kind: 'write'; step: Extract<Instruction, { do: 'write' }>; words: string[]; line: number }
  | { kind: 'item'; step: Extract<Instruction, { do: 'list' }>; n: number; words: string[]; line: number };

const keyOf = (t: Target): string =>
  t.kind === 'part' || t.kind === 'lit'
    ? `${t.ref}#${t.part}`
    : t.kind === 'place'
      ? t.id
      : t.kind === 'item'
        ? `item:${t.step.heading ?? ''}#${t.n}`
        : `write:${t.step.text}`;

/** Writing a line may put on the board's regions: a line with any of it is not given a mark. */
const WRITING_NEW: ReadonlySet<string> = new Set(['write', 'list', 'note', 'card', 'summary', 'compare', 'caption', 'equation', 'derive']);

/** Which kind wins a tie: a picture's part, then the scene, then a list's item, then writing. */
const RANK: Record<Target['kind'], number> = { part: 0, lit: 0, place: 1, item: 2, write: 3 };

/** The thing an existing mark is on, keyed the way targets are. */
function markedKey(step: Instruction, board: readonly Instruction[]): string | null {
  if (step.do === 'point') return `${step.ref}#${step.part}`;
  if (step.do !== 'annotate') return null;
  const item = /^(.+)#(\d+)$/.exec(step.target);
  const list = item ? board.find((s) => s.do === 'list' && s.id === item[1]) : undefined;
  if (item && list) return `item:${(list as { heading?: string }).heading ?? ''}#${item[2]}`;
  if (step.target.includes('#')) return step.target;
  const written = board.find((s) => s.do === 'write' && s.id === step.target);
  return written ? `write:${(written as { text: string }).text}` : step.target;
}

export function addMarks(beats: ScriptBeat[], visuals: readonly VisualBrief[]): number {
  const briefs = new Map(visuals.map((v) => [v.id, v]));
  let added = 0;
  for (const beat of beats) {
    if (!beat.board.some((s) => s.do === 'say')) continue;
    const taken = new Set(beat.board.flatMap((s) => ('id' in s && typeof s.id === 'string' ? [s.id] : [])));

    // The board in lines: what comes before the first say, then each say and what follows it.
    const lines: { say: Extract<Instruction, { do: 'say' }> | null; items: Instruction[] }[] = [{ say: null, items: [] }];
    for (const step of beat.board) {
      if (step.do === 'say') lines.push({ say: step, items: [] });
      else lines[lines.length - 1].items.push(step);
    }

    const targets: Target[] = [];
    /** What was marked on each line, by key. */
    const markedOn: Set<string>[] = [];
    lines.forEach((line, n) => {
      // Marks the line already makes.
      const own = new Set(line.items.map((s) => markedKey(s, beat.board)).filter((k): k is string => k !== null));
      // A picture shown up to and including this line can have its parts marked on it.
      for (const step of line.items) {
        if (step.do === 'picture' || step.do === 'diagram') {
          for (const part of briefs.get(step.ref)?.parts ?? []) {
            const words = stemsOf(part.replace(/[_-]+/g, ' '));
            targets.push({ kind: step.do === 'picture' ? 'part' : 'lit', ref: step.ref, part, words, line: n });
          }
        }
      }
      const said = line.say ? stemsOf(line.say.text) : [];
      const recent = new Set([...(markedOn[n - 1] ?? []), ...(markedOn[n - 2] ?? [])]);
      // A line that writes something new is moving the board already, and its
      // writing may run onto the beat's next page: a mark it was given on the
      // first page took the camera back there, and the writing was never on
      // screen (human heart, 2026-10-07).
      const writes = line.items.some((s) => WRITING_NEW.has(s.do));
      if (line.say && own.size === 0 && !writes) {
        let best: { t: Target; score: number } | null = null;
        for (const t of targets) {
          // What this line placed or wrote is new ink already; a part of a picture may be circled as it is named.
          if (t.line === n && t.kind !== 'part' && t.kind !== 'lit') continue;
          if (recent.has(keyOf(t)) || t.words.length === 0) continue;
          const hits = t.words.filter((w) => said.some((s) => same(s, w))).length;
          if (hits === 0) continue;
          const score = hits / t.words.length + hits * 0.01 - RANK[t.kind] * 0.001;
          if (!best || score > best.score) best = { t, score };
        }
        if (best) {
          const mark = markFor(best.t, taken, beat.id);
          const ask = line.items.findIndex((s) => s.do === 'ask');
          line.items.splice(ask < 0 ? line.items.length : ask, 0, mark);
          own.add(keyOf(best.t));
          added += 1;
        }
      }
      markedOn[n] = own;
      // What this line placed or wrote can be marked on a later one.
      for (const step of line.items) {
        if (step.do === 'place') targets.push({ kind: 'place', id: step.id, words: stemsOf(`${step.noun} ${step.label ?? ''}`), line: n });
        if (step.do === 'write') targets.push({ kind: 'write', step, words: stemsOf(step.text), line: n });
        if (step.do === 'list') {
          step.items.forEach((it, k) => targets.push({ kind: 'item', step, n: k, words: stemsOf(it.term), line: n }));
        }
      }
    });

    beat.board = lines.flatMap((line) => [...(line.say ? [line.say] : []), ...line.items]);
  }
  return added;
}

function markFor(t: Target, taken: Set<string>, beatId: string): Instruction {
  if (t.kind === 'part') return { do: 'annotate', target: `${t.ref}#${t.part}`, mark: 'circle' };
  if (t.kind === 'lit') return { do: 'point', ref: t.ref, part: t.part };
  if (t.kind === 'place') return { do: 'annotate', target: t.id, mark: 'circle' };
  if (t.kind === 'item') {
    if (!t.step.id) {
      let n = 1;
      while (taken.has(`${beatId}_list${n}`)) n += 1;
      t.step.id = `${beatId}_list${n}`;
      taken.add(t.step.id);
    }
    return { do: 'annotate', target: `${t.step.id}#${t.n}`, mark: 'highlight' };
  }
  if (!t.step.id) {
    let n = 1;
    while (taken.has(`${beatId}_kp${n}`)) n += 1;
    t.step.id = `${beatId}_kp${n}`;
    taken.add(t.step.id);
  }
  return { do: 'annotate', target: t.step.id, mark: 'underline' };
}
