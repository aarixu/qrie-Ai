import { describe, expect, it } from 'vitest';
import type { Instruction, ScriptBeat } from '@ai-tutor/board-layout';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { addMarks } from '../src/marks';
import { assemble } from '../src/prepare';
import { gateLesson } from '../src/gate';
import { splitNarrations } from '../src/sayLines';
import type { VisualBrief } from '../src/types';
import { SMALL_INTESTINE } from './fixtures/smallIntestine';

/**
 * WHAT SHE TALKS ABOUT, SHE MARKS (Aarav, 2026-10-07: "har 1-2 line me jahan
 * jis diagram, text, image ya jis k baare me bhi tum baat kr rhe ho unko annote
 * kr skte hai").
 *
 * A line that talks about a part of the picture circles it; one that comes
 * back to a key point written earlier underlines it; one that talks about a
 * thing in the scene circles that. A line that already marks something is
 * left alone, and the same thing is not marked on two lines running.
 */

const VILLUS: VisualBrief = {
  id: 'villus',
  medium: 'picture',
  parts: ['epithelium', 'blood capillaries', 'lacteal'],
  brief: 'One villus.',
  alt: 'A villus',
};

const marksIn = (board: readonly Instruction[]) =>
  board.flatMap((s, n) => (s.do === 'annotate' ? [{ n, target: s.target, mark: s.mark }] : []));
const lineOf = (board: readonly Instruction[], n: number): string => {
  for (let k = n; k >= 0; k -= 1) if (board[k].do === 'say') return (board[k] as { text: string }).text;
  return '';
};

describe('addMarks', () => {
  it('circles the part of the picture a line talks about, on that line', () => {
    const beat: ScriptBeat = {
      id: 'b3',
      topic: 'Villi',
      narration: '',
      board: [
        { do: 'say', text: 'Here is one villus.' },
        { do: 'picture', ref: 'villus' },
        { do: 'say', text: 'Its outer layer, the epithelium, is one cell thick.' },
        { do: 'label', target: 'villus#epithelium', text: 'Epithelium' },
        { do: 'say', text: 'In the centre runs the lacteal, which takes in fats.' },
        { do: 'write', text: 'Lacteal absorbs fats' },
      ],
    };
    expect(addMarks([beat], [VILLUS])).toBe(2);
    const marks = marksIn(beat.board);
    expect(marks.map((m) => [m.target, m.mark])).toEqual([
      ['villus#epithelium', 'circle'],
      ['villus#lacteal', 'circle'],
    ]);
    expect(lineOf(beat.board, marks[1].n)).toContain('lacteal');
  });

  it('underlines a key point written before, when a later line comes back to it', () => {
    const beat: ScriptBeat = {
      id: 'b2',
      topic: 'Bile',
      narration: '',
      board: [
        { do: 'say', text: 'Bile turns big fat globules into tiny droplets.' },
        { do: 'write', text: 'Bile emulsifies fat globules' },
        { do: 'say', text: 'This emulsification gives lipase far more fat surface to work on.' },
      ],
    };
    addMarks([beat], []);
    const write = beat.board.find((s) => s.do === 'write') as { id?: string };
    expect(write.id).toBeTruthy();
    expect(marksIn(beat.board)).toEqual([expect.objectContaining({ target: write.id, mark: 'underline' })]);
    expect(lineOf(beat.board, marksIn(beat.board)[0].n)).toContain('emulsification');
  });

  it('circles a thing in the scene a later line talks about', () => {
    const beat: ScriptBeat = {
      id: 'b1',
      topic: 'Journey',
      narration: '',
      board: [
        { do: 'say', text: 'Food leaves the stomach as a paste.' },
        { do: 'place', id: 'stomach', noun: 'stomach', label: 'Stomach' },
        { do: 'place', id: 'intestine', noun: 'intestine', label: 'Small intestine' },
        { do: 'say', text: 'The stomach churns it with acid for hours.' },
      ],
    };
    addMarks([beat], []);
    expect(marksIn(beat.board).map((m) => [m.target, m.mark])).toEqual([['stomach', 'circle']]);
  });

  it('leaves a line that already marks something, keeps an ask last, and does not mark one thing twice running', () => {
    const beat: ScriptBeat = {
      id: 'b3',
      topic: 'Villi',
      narration: '',
      board: [
        { do: 'say', text: 'Here is one villus and its lacteal.' },
        { do: 'picture', ref: 'villus' },
        { do: 'annotate', target: 'villus#lacteal', mark: 'circle' },
        { do: 'say', text: 'The lacteal is a lymph vessel.' },
        { do: 'say', text: 'So which vessel in the villus takes in fats, the lacteal or the capillaries?' },
        { do: 'ask', question: 'Which vessel takes in fats?', expect: 'the lacteal', hint: 'Think lymph.' },
      ],
    };
    addMarks([beat], [VILLUS]);
    const marks = marksIn(beat.board);
    // Line 2 talks about the lacteal just marked on line 1: not marked again.
    expect(marks.filter((m) => m.target === 'villus#lacteal')).toHaveLength(1);
    // The ask's line marks the capillaries, and the ask stays last.
    expect(beat.board[beat.board.length - 1].do).toBe('ask');
    expect(marks.some((m) => m.target === 'villus#blood capillaries')).toBe(true);
  });

  it('marks the small-intestine class without breaking any rule of the keep gate', () => {
    const run = (marked: boolean) => {
      const plan = structuredClone(SMALL_INTESTINE);
      splitNarrations(plan.beats, plan.visuals);
      const added = marked ? addMarks(plan.beats, plan.visuals) : 0;
      const parts = new Map([
        [
          'villus_structure',
          [
            { name: 'microvilli', x: 0.3, y: 0.02, w: 0.3, h: 0.1 },
            { name: 'blood capillaries', x: 0.15, y: 0.3, w: 0.2, h: 0.4 },
            { name: 'single-cell epithelium', x: 0.7, y: 0.3, w: 0.15, h: 0.4 },
            { name: 'central lacteal', x: 0.45, y: 0.2, w: 0.1, h: 0.6 },
          ],
        ],
      ]);
      const made = assemble(plan, new Set(['villus_structure']), parts, new Map([['villus_structure', 0.75]]));
      const checked = validateLesson(made.lesson);
      const rules = checked.ok
        ? gateLesson(checked.lesson as Lesson, {
            bonds: made.bonds,
            unspoken: made.unspoken,
            undrawn: made.undrawn,
            composer: made.composer,
            mathsCheck: () => ({ ok: true, failures: [] }),
          }).map((p) => p.rule)
        : ['invalid'];
      return { added, rules: new Set(rules) };
    };
    const plain = run(false);
    const marked = run(true);
    expect(marked.added).toBeGreaterThanOrEqual(4);
    for (const rule of marked.rules) expect(plain.rules.has(rule), rule).toBe(true);
  });

  it('highlights the item of a list a later line talks about', () => {
    const beat: ScriptBeat = {
      id: 'b4',
      topic: 'Why',
      narration: '',
      board: [
        { do: 'say', text: 'Complete separation matters for three reasons.' },
        {
          do: 'list',
          heading: 'Why complete separation matters',
          items: [
            { term: 'Pure oxygen supply', meaning: 'no mixing of blood' },
            { term: 'High energy output', meaning: 'for active animals' },
            { term: 'Constant temperature', meaning: 'whatever the weather' },
          ],
        },
        { do: 'say', text: 'Birds and humans keep a constant body temperature in any weather.' },
      ],
    };
    addMarks([beat], []);
    const list = beat.board.find((s) => s.do === 'list') as { id?: string };
    expect(list.id).toBeTruthy();
    expect(marksIn(beat.board)).toEqual([expect.objectContaining({ target: `${list.id}#2`, mark: 'highlight' })]);
  });

  it('lights a part of a diagram rather than circling it', () => {
    const heart: VisualBrief = { id: 'heart', medium: 'diagram', parts: ['left_ventricle'], brief: 'A heart.', alt: 'heart' };
    const beat: ScriptBeat = {
      id: 'b1',
      topic: 'Heart',
      narration: '',
      board: [
        { do: 'say', text: 'This is the heart.' },
        { do: 'diagram', ref: 'heart' },
        { do: 'say', text: 'The left ventricle has the thickest wall.' },
      ],
    };
    addMarks([beat], [heart]);
    expect(beat.board).toContainEqual({ do: 'point', ref: 'heart', part: 'left_ventricle' });
  });
});
