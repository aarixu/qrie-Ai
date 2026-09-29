import type { Tone } from '@ai-tutor/lesson-format';
import {
  LIMITS,
  type BoardOp,
  type Dropped,
  type ListItem,
  type LiveStep,
  type MarkShape,
  type WorkLine,
} from './types';

/**
 * parseBoardOps — the one door between a model's JSON and the board.
 *
 * Whatever comes in — a string, a fenced block, an object with extra keys, a
 * number, nothing — what comes out is a list of clean steps and a list of what
 * was refused. It NEVER throws: a turn with one bad op still teaches with the
 * rest, and a turn that is garbage teaches nothing rather than taking the
 * class down with it.
 *
 * What it guarantees about every op it keeps:
 *
 *   - its kind is one of the closed list in types.ts;
 *   - it carries ONLY the fields the format names. Each op is rebuilt from a
 *     whitelist, so `x`, `y`, `w`, `h`, `from`, `to`, `size` — any position a
 *     model tries to choose — never reach the layout;
 *   - every string is a string, trimmed, with control characters removed and
 *     (outside a note) whitespace collapsed to single spaces, and within its
 *     cap. A string over its cap drops its op; it is never cut (see LIMITS);
 *   - every id it creates is minted here as `live<n>_<k>`, and every id it
 *     refers to was either on screen (`onScreenIds`) or minted earlier in the
 *     same turn. A forward reference is dropped: she cannot circle a line she
 *     has not written yet;
 *   - a model's name for its own ink never shadows an id on screen, so a model
 *     that calls its line `b3_2` cannot redirect a mark meant for the real one.
 *
 * What it does NOT do, and the caller must: screen the words. Nothing here
 * decides whether a sentence is fit for a child. `boardStrings` below lists
 * every string a parsed turn would put in front of one, so the caller can run
 * each through the app's `toStudent` and, on a support verdict, halt the
 * session (apps/classroom/src/lib/sessionHalt.ts) before anything is spoken
 * or drawn. NOT WIRED: no app code calls this package yet (T2.4 does).
 *
 * Nor does it check that a mark's target is on the same PAGE, or that a recall
 * names a real beat when no beat list is given — it cannot see the board. The
 * layout checks both (layout.ts).
 */

export interface ParseOptions {
  /**
   * The turn number, `n` in `live<n>_<k>`. Defaults to one more than the
   * highest `live<n>_` id in `onScreenIds`, or 1 when there is none. Pass
   * `nextTurn(state)` from the layout to keep the two in step; the layout
   * refuses a minted id that is already on the board either way.
   */
  turn?: number;
  /** The lesson's beat ids. When given, a `recall` of any other beat is dropped here. */
  beatIds?: ReadonlySet<string>;
}

const TONES: ReadonlySet<string> = new Set<Tone>(['neutral', 'good', 'bad', 'accent']);
const SHAPES: ReadonlySet<string> = new Set<MarkShape>(['circle', 'underline', 'box', 'cross', 'tick']);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Control characters out, except the newline a note may use for a paragraph.
 * Kept as a character class so a stray NUL or BEL from a model never reaches
 * a TTS engine or an SVG text node.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/** One line: trimmed, single-spaced, no control characters. Null when not a string. */
function line(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/** A note keeps its paragraphs: newlines survive, runs of spaces do not. */
function paragraph(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return v
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The highest `n` in any `live<n>_…` id on screen. */
function highestTurn(ids: ReadonlySet<string>): number {
  let high = 0;
  for (const id of ids) {
    const m = /^live(\d+)_/.exec(id);
    if (m) high = Math.max(high, Number(m[1]));
  }
  return high;
}

/**
 * What the model handed in, as a list of raw steps — or the reason it is not one.
 *
 * A model asked for JSON sometimes wraps it in a ```json fence; the fence is
 * taken off rather than failing the turn over formatting.
 */
function rawSteps(json: unknown): unknown[] | string {
  let value = json;
  if (typeof value === 'string') {
    const unfenced = value
      .trim()
      .replace(/^```[a-zA-Z]*\s*\n?/, '')
      .replace(/\n?```\s*$/, '');
    try {
      value = JSON.parse(unfenced);
    } catch {
      return 'not JSON';
    }
  }
  if (Array.isArray(value)) return value;
  if (isObj(value) && Array.isArray(value.steps)) return value.steps;
  return 'not a list of steps';
}

export function parseBoardOps(
  json: unknown,
  onScreenIds: ReadonlySet<string>,
  opts: ParseOptions = {},
): { steps: LiveStep[]; dropped: Dropped[] } {
  const dropped: Dropped[] = [];
  const raw = rawSteps(json);
  if (typeof raw === 'string') return { steps: [], dropped: [{ at: '$', reason: raw }] };

  const turn =
    typeof opts.turn === 'number' && Number.isInteger(opts.turn) && opts.turn > 0
      ? opts.turn
      : highestTurn(onScreenIds) + 1;
  /** The model's names for ink it wrote earlier in this turn, to the ids they were given. */
  const alias = new Map<string, string>();
  let minted = 0;
  let weight = 0;
  const steps: LiveStep[] = [];

  /** An id a referring op may use: on screen, or written earlier in this turn. */
  const resolve = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const name = v.trim();
    if (onScreenIds.has(name)) return name;
    return alias.get(name) ?? null;
  };
  /**
   * Remember the model's name for the ink it just created — unless that name
   * is already on screen, in which case the on-screen element keeps it.
   */
  const remember = (v: unknown, id: string): void => {
    if (typeof v !== 'string') return;
    const name = v.trim();
    if (name && !onScreenIds.has(name)) alias.set(name, id);
  };
  const tooLong = (what: string, cap: number) => `${what} is over the ${cap}-character cap`;

  /**
   * One raw op to one clean op, or the reason it was refused. Ids are minted
   * only once an op is known to be kept, so the numbering has no holes.
   */
  const parseOp = (o: unknown): { op: BoardOp; names: [unknown, string][] } | string => {
    if (!isObj(o)) return 'not an op object';
    const kind = o.op;
    const id = () => `live${turn}_${minted}`;
    switch (kind) {
      case 'write':
      case 'equation': {
        const text = line(o.text);
        if (!text) return `${kind} needs text`;
        if (text.length > LIMITS.line) return tooLong(`${kind} text`, LIMITS.line);
        const made = id();
        return { op: { op: kind, id: made, text }, names: [[o.id, made]] };
      }
      case 'note': {
        const text = paragraph(o.text);
        if (!text) return 'note needs text';
        if (text.length > LIMITS.note) return tooLong('note text', LIMITS.note);
        const made = id();
        const tone = typeof o.tone === 'string' && TONES.has(o.tone) ? (o.tone as Tone) : undefined;
        return { op: { op: 'note', id: made, text, ...(tone ? { tone } : {}) }, names: [[o.id, made]] };
      }
      case 'list': {
        if (!Array.isArray(o.items)) return 'list needs items';
        if (o.items.length > LIMITS.listItems) return `list has more than ${LIMITS.listItems} items`;
        const items: ListItem[] = [];
        for (const it of o.items) {
          const term = line(isObj(it) ? it.term : it);
          const meaning = isObj(it) ? line(it.meaning) : null;
          if (!term) continue;
          if (term.length > LIMITS.heading) return tooLong('a list term', LIMITS.heading);
          if (meaning && meaning.length > LIMITS.line) return tooLong('a list meaning', LIMITS.line);
          items.push(meaning ? { term, meaning } : { term });
        }
        if (items.length === 0) return 'list needs at least one item with words in it';
        const heading = line(o.heading);
        if (heading && heading.length > LIMITS.heading) return tooLong('list heading', LIMITS.heading);
        const made = id();
        return { op: { op: 'list', id: made, ...(heading ? { heading } : {}), items }, names: [[o.id, made]] };
      }
      case 'card': {
        const title = line(o.title);
        const body = line(o.body);
        if (!title || !body) return 'card needs a title and a body';
        if (title.length > LIMITS.heading) return tooLong('card title', LIMITS.heading);
        if (body.length > LIMITS.cardBody) return tooLong('card body', LIMITS.cardBody);
        const made = id();
        return { op: { op: 'card', id: made, title, body }, names: [[o.id, made]] };
      }
      case 'work': {
        if (!Array.isArray(o.steps) || o.steps.length === 0) return 'work needs steps';
        if (o.steps.length > LIMITS.workLines) return `work has more than ${LIMITS.workLines} lines`;
        const made = id();
        const lines: WorkLine[] = [];
        const names: [unknown, string][] = [];
        for (const [j, s] of o.steps.entries()) {
          // A worked solution is kept whole or not at all: a line missing
          // from the middle of working is a different, wrong derivation.
          if (!isObj(s)) return `work line ${j} is not an object`;
          const text = line(s.line);
          if (!text) return `work line ${j} has no line`;
          if (text.length > LIMITS.line) return tooLong(`work line ${j}`, LIMITS.line);
          const say = line(s.say) ?? '';
          if (say.length > LIMITS.say) return tooLong(`work line ${j}'s sentence`, LIMITS.say);
          const lineId = `${made}_s${j}`;
          lines.push({ id: lineId, say, line: text });
          names.push([s.id, lineId]);
        }
        return { op: { op: 'work', id: made, steps: lines }, names };
      }
      case 'mark': {
        const shape = typeof o.shape === 'string' && SHAPES.has(o.shape) ? (o.shape as MarkShape) : null;
        if (!shape) return `mark shape ${JSON.stringify(o.shape)} is not one of ${[...SHAPES].join(', ')}`;
        const targetId = resolve(o.targetId);
        if (!targetId) return `mark target ${JSON.stringify(o.targetId)} is not on screen or written earlier in this turn`;
        const span = line(o.span);
        if (span && span.length > LIMITS.line) return tooLong('mark span', LIMITS.line);
        return { op: { op: 'mark', id: id(), targetId, shape, ...(span ? { span } : {}) }, names: [] };
      }
      case 'arrow': {
        const fromId = resolve(o.fromId);
        const toId = resolve(o.toId);
        if (!fromId) return `arrow start ${JSON.stringify(o.fromId)} is not on screen or written earlier in this turn`;
        if (!toId) return `arrow end ${JSON.stringify(o.toId)} is not on screen or written earlier in this turn`;
        if (fromId === toId) return 'an arrow from a thing to itself says nothing';
        const label = line(o.label);
        if (label && label.length > LIMITS.label) return tooLong('arrow label', LIMITS.label);
        return { op: { op: 'arrow', id: id(), fromId, toId, ...(label ? { label } : {}) }, names: [] };
      }
      case 'point': {
        const ids = Array.isArray(o.ids) ? o.ids.map(resolve).filter((x): x is string => x !== null) : [];
        const unique = [...new Set(ids)].slice(0, LIMITS.pointIds);
        if (unique.length === 0) return 'point names nothing on screen';
        return { op: { op: 'point', ids: unique }, names: [] };
      }
      case 'recall': {
        const beatId = line(o.beatId);
        if (!beatId) return 'recall needs a beat id';
        if (opts.beatIds && !opts.beatIds.has(beatId)) return `recall names no beat "${beatId}"`;
        return { op: { op: 'recall', beatId }, names: [] };
      }
      case 'newPage':
        return { op: { op: 'newPage' }, names: [] };
      default:
        return `unknown op ${JSON.stringify(kind)}`;
    }
  };

  raw.forEach((s, i) => {
    const at = `steps[${i}]`;
    if (steps.length >= LIMITS.steps) {
      dropped.push({ at, reason: `over the ${LIMITS.steps}-step cap` });
      return;
    }
    if (!isObj(s)) {
      dropped.push({ at, reason: 'not a step object' });
      return;
    }
    const say = line(s.say) ?? '';
    if (say.length > LIMITS.say) {
      dropped.push({ at, reason: tooLong('say', LIMITS.say) });
      return;
    }
    const ink: BoardOp[] = [];
    const rawInk = Array.isArray(s.ink) ? s.ink : [];
    if (s.ink !== undefined && !Array.isArray(s.ink)) dropped.push({ at: `${at}.ink`, reason: 'ink is not a list' });
    rawInk.forEach((o, j) => {
      const opAt = `${at}.ink[${j}]`;
      const parsed = parseOp(o);
      if (typeof parsed === 'string') {
        dropped.push({ at: opAt, reason: parsed });
        return;
      }
      const w = parsed.op.op === 'work' ? parsed.op.steps.length : 1;
      if (weight + w > LIMITS.ops) {
        dropped.push({ at: opAt, reason: `over the ${LIMITS.ops}-op cap for one turn` });
        return;
      }
      weight += w;
      if ('id' in parsed.op) minted += 1;
      for (const [name, made] of parsed.names) remember(name, made);
      ink.push(parsed.op);
    });
    if (!say && ink.length === 0) {
      dropped.push({ at, reason: 'nothing to say and nothing to write' });
      return;
    }
    steps.push({ say, ink });
  });

  return { steps, dropped };
}

/**
 * Keys that hold ids, names from a closed list, or a quotation of text that is
 * already on the board — never new words.
 */
const NOT_WORDS: ReadonlySet<string> = new Set([
  'op',
  'id',
  'targetId',
  'fromId',
  'toId',
  'ids',
  'beatId',
  'shape',
  'tone',
  'span',
]);

/**
 * EVERY STRING A PARSED TURN WOULD PUT IN FRONT OF A CHILD, for the safety screen.
 *
 * The sentences she will say and every piece of text she will write, in turn
 * order. It WALKS each op rather than listing fields, and skips only keys
 * known to hold ids or closed-list names — so a string field added to an op
 * later is screened by default instead of slipping past a list nobody
 * updated. (`span` is skipped because it must quote text already on the
 * board, which was screened when it was written.)
 */
export function boardStrings(steps: readonly LiveStep[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v) out.push(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) if (!NOT_WORDS.has(k)) walk(x);
    }
  };
  for (const step of steps) {
    if (step.say) out.push(step.say);
    for (const op of step.ink) walk(op);
  }
  return out;
}
