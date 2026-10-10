import type { Instruction } from '@ai-tutor/board-layout';
import type { Blueprint } from '../../src/types';

/**
 * SEEDED, SYNTHETIC CLASSES — the shapes the planner actually writes, with
 * random words and random amounts, so a layout rule can be measured over
 * hundreds of classes at no cost (canvas C0, item 6). The same seed always
 * gives the same class.
 *
 * Shapes, from the canvas audit's generator (2026-10-01): a scene of placed
 * things with connectors and key points; a labelled picture with key points
 * and sometimes a list; and a run of maths working. Every beat asks once, as
 * the prompt requires, and its answer arrives after a line.
 */

type Part = { name: string; x: number; y: number; w: number; h: number };

export function fuzzPlan(
  seed: number,
  opts: { smartBoard?: boolean; tools?: boolean; composed?: boolean } = {},
): {
  plan: Blueprint;
  drawn: Set<string>;
  parts: Map<string, Part[]>;
  shapes: Map<string, number>;
} {
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const int = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const WORDS =
    'blood oxygen glucose energy cells lungs heart muscle yeast dough sugar water carbon dioxide air food kidney urine waste body plant leaf root sunlight gas tube vessel pump release carried through into from the and of to'.split(
      ' ',
    );
  const phrase = (lo: number, hi: number): string => {
    let out = '';
    const n = int(lo, hi);
    while (out.length < n) out += (out ? ' ' : '') + pick(WORDS);
    return out;
  };
  const sentence = (lo: number, hi: number): string => {
    const t = phrase(lo, hi);
    return t[0].toUpperCase() + t.slice(1);
  };

  const visuals: Blueprint['visuals'] = [];
  const drawn = new Set<string>();
  const parts = new Map<string, Part[]>();
  const shapes = new Map<string, number>();

  const ask = (): Instruction[] => [
    { do: 'say', text: `${sentence(20, 50)}?` },
    { do: 'ask', question: `${sentence(30, 70)}?`, expect: phrase(10, 30), hint: `${sentence(15, 40)}?` },
    { do: 'say', text: sentence(20, 60) },
    { do: 'write', text: sentence(18, 50) },
  ];

  const scene = (b: number): Instruction[] => {
    const n = int(2, 5);
    const board: Instruction[] = [];
    if (rnd() < 0.4) board.push({ do: 'title', text: sentence(12, 30) });
    board.push({ do: 'say', text: sentence(20, 60) });
    const ids: string[] = [];
    for (let k = 0; k < n; k += 1) {
      const id = `s${b}p${k}`;
      ids.push(id);
      board.push({ do: 'place', id, noun: pick(WORDS), ...(rnd() < 0.85 ? { label: phrase(4, 20) } : {}) } as Instruction);
    }
    for (let k = 0; k < int(1, Math.min(3, n - 1)); k += 1) {
      const a = int(0, n - 2);
      board.push({ do: 'say', text: sentence(20, 60) });
      board.push({ do: 'connect', from: ids[a], to: ids[a + 1], ...(rnd() < 0.75 ? { label: phrase(6, 28) } : {}) } as Instruction);
    }
    for (let k = 0; k < int(0, 3); k += 1) {
      board.push({ do: 'say', text: sentence(20, 60) });
      board.push({ do: 'write', text: sentence(22, 60) });
    }
    return board;
  };

  const picture = (b: number): Instruction[] => {
    const ref = `pic${b}`;
    visuals.push({ id: ref, brief: 'a picture', alt: 'a picture', parts: [] } as never);
    drawn.add(ref);
    const n = int(3, 6);
    const ys = Array.from({ length: n }, () => 0.05 + rnd() * 0.8).sort((x, y) => x - y);
    const own: Part[] = [];
    const board: Instruction[] = [{ do: 'say', text: sentence(20, 60) }, { do: 'picture', ref } as Instruction];
    for (let k = 0; k < n; k += 1) {
      const name = `part${k}`;
      own.push({ name, x: 0.05 + rnd() * 0.75, y: ys[k], w: 0.05 + rnd() * 0.15, h: 0.05 + rnd() * 0.12 });
      if (rnd() < 0.5) board.push({ do: 'annotate', target: `${ref}#${name}`, mark: 'circle' } as Instruction);
      board.push({ do: 'label', target: `${ref}#${name}`, text: sentence(5, 18) } as Instruction);
    }
    parts.set(ref, own);
    shapes.set(ref, 0.6 + rnd() * 1.2);
    for (let k = 0; k < int(1, 3); k += 1) {
      board.push({ do: 'say', text: sentence(20, 60) });
      board.push({ do: 'write', text: sentence(22, 60) });
    }
    if (rnd() < 0.3) {
      board.push({
        do: 'list',
        heading: 'Parts',
        items: Array.from({ length: int(3, 5) }, () => ({ term: sentence(5, 14), meaning: phrase(15, 40) })),
      });
    }
    return board;
  };

  const working = (): Instruction[] => {
    const board: Instruction[] = [{ do: 'title', text: sentence(12, 30) }, { do: 'say', text: sentence(20, 60) }];
    for (let k = 0; k < int(2, 4); k += 1) {
      board.push({ do: 'say', text: sentence(20, 60) });
      for (let j = 0; j < int(1, 3); j += 1) board.push({ do: 'equation', text: `${int(2, 9)}x + ${int(1, 20)} = ${int(21, 60)}` });
    }
    return board;
  };

  const beats: Blueprint['beats'] = Array.from({ length: int(3, 5) }, (_, b) => {
    const kind = pick(['scene', 'picture', 'working'] as const);
    const body = kind === 'scene' ? scene(b) : kind === 'picture' ? picture(b) : working();
    return { id: `b${b + 1}`, topic: `Part ${b + 1}`, narration: '', board: [...body, ...ask()] };
  });

  /**
   * The smart board's own moves (canvas C3): key points she frames and
   * highlights, a clean page, a marked equation. Drawn from the random stream
   * only after every beat above, so turning it on leaves those beats exactly
   * as they were and the measured numbers stay comparable.
   */
  if (opts.smartBoard) {
    const b = beats.length;
    const first = sentence(18, 40);
    const word = first.split(' ')[1] ?? first.split(' ')[0];
    const board: Instruction[] = [
      { do: 'say', text: sentence(20, 60) },
      { do: 'write', id: `k${b}a`, text: first },
      { do: 'say', text: sentence(20, 60) },
      { do: 'annotate', target: `k${b}a`, mark: 'box' },
      { do: 'say', text: sentence(20, 60) },
      { do: 'annotate', target: `k${b}a`, mark: 'highlight', span: word },
      { do: 'say', text: sentence(20, 60) },
      { do: 'newPage' },
      { do: 'write', id: `k${b}b`, text: sentence(18, 40) },
      { do: 'say', text: sentence(20, 60) },
      { do: 'equation', id: `e${b}`, text: `${int(2, 9)}x + ${int(1, 20)} = ${int(21, 60)}` },
      { do: 'annotate', target: `e${b}`, mark: 'underline' },
    ];
    beats.push({ id: `b${b + 1}`, topic: `Part ${b + 1}`, narration: '', board: [...board, ...ask()] });
    // A graph with key points beside it.
    const graph: Instruction[] = [
      { do: 'say', text: sentence(20, 60) },
      { do: 'plot', fn: pick(['2x + 1', 'x^2 - 4', 'sin(x)', '3 - x', '1/x']), from: -int(1, 5), to: int(1, 5), x: 'x', y: 'y' },
    ];
    for (let k = 0; k < int(1, 3); k += 1) {
      graph.push({ do: 'say', text: sentence(20, 60) }, { do: 'write', text: sentence(14, 40) });
    }
    beats.push({ id: `b${b + 2}`, topic: `Part ${b + 2}`, narration: '', board: [...graph, ...ask()] });
    // Working, step under step.
    const [p, q] = [int(2, 9), int(1, 20)];
    const answer = int(1, 12);
    beats.push({
      id: `b${b + 3}`,
      topic: `Part ${b + 3}`,
      narration: '',
      board: [
        { do: 'say', text: sentence(20, 60) },
        { do: 'derive', steps: [`${p}x + ${q} = ${p * answer + q}`, `${p}x = ${p * answer}`, `x = ${answer}`] },
        { do: 'say', text: sentence(20, 60) },
        { do: 'write', text: sentence(14, 40) },
        ...ask(),
      ],
    });
  }

  /**
   * The toolkit (canvas toolkit part 1): one tool a beat, each with a line long
   * enough for it to draw, so the measured numbers say what layout and the gate
   * do with tools rather than what a too-short line does.
   */
  if (opts.tools) {
    const b = beats.length;
    const sliceCount = int(2, 5);
    const shares = Array.from({ length: sliceCount }, () => int(5, 40));
    const total = shares.reduce((a, v) => a + v, 0);
    const slices = shares.map((v, k) => ({ label: `part ${k + 1}`, value: Number(((v / total) * 100).toFixed(1)) }));
    slices[0].value = Number((100 - slices.slice(1).reduce((a, s) => a + s.value, 0)).toFixed(1));
    const labels = Array.from({ length: int(3, 8) }, (_, k) => `t${k + 1}`);
    const [p, q] = [int(2, 9), int(1, 20)];
    const answer = int(1, 12);
    const toolBeats: Instruction[][] = [
      [{ do: 'say', text: sentence(90, 120) }, { do: 'pieChart', slices, percent: true }],
      [{ do: 'say', text: sentence(90, 120) }, { do: 'lineChart', labels, series: [{ name: 'value', values: labels.map(() => int(1, 50)) }] }],
      [
        { do: 'say', text: sentence(90, 120) },
        { do: 'equationMove', steps: [`${p}x + ${q} = ${p * answer + q}`, `${p}x = ${p * answer + q} - ${q}`, `${p}x = ${p * answer}`, `x = ${answer}`] },
      ],
    ];
    toolBeats.forEach((board, k) => {
      beats.push({ id: `b${b + k + 1}`, topic: `Part ${b + k + 1}`, narration: '', board: [...board, ...ask()] });
    });
  }
  const plan: Blueprint = { id: `fuzz-${seed}`, title: 'Fuzz', visuals, beats };
  /**
   * A composed board, written the way the page contract asks (board
   * composer, prompts.ts PAGE_CONTRACT): every title with its path, and every
   * beat ending with its notes (a list of three terms and what they do), at
   * least three key points, and a summary.
   */
  if (opts.composed) {
    plan.layout = 'composed';
    for (const b of plan.beats) {
      b.board = b.board.map((step) => (step.do === 'title' ? { ...step, path: ['Chapter', step.text] } : step));
      const written = b.board.filter((step) => step.do === 'write').length;
      b.board.push(
        { do: 'say', text: sentence(20, 50) },
        {
          do: 'list',
          heading: phrase(8, 20),
          items: [1, 2, 3].map(() => ({ term: phrase(6, 14), meaning: phrase(18, 36) })),
        },
      );
      for (let k = written; k < 3; k += 1) b.board.push({ do: 'say', text: sentence(20, 50) }, { do: 'write', text: sentence(18, 40) });
      b.board.push({ do: 'say', text: sentence(20, 50) }, { do: 'summary', text: sentence(18, 40) });
    }
  }
  return { plan, drawn, parts, shapes };
}
