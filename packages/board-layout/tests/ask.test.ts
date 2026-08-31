import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * The ASK instruction: the question goes on the board, the options under it,
 * and the beat is marked so the player knows to stop and listen.
 *
 * The board half is nothing new — a written question and a lettered list, the
 * same ink as everything else, so the said-but-not-written check is satisfied
 * by construction. The new half is the MARKER: layout tells the assembler
 * which spoken moment carries the question, and the assembler puts it on the
 * lesson beat the player will hold on.
 */

const board: Instruction[] = [
  { do: 'title', text: 'Spaces between particles' },
  { do: 'say', text: 'Watch the level as the sugar stirs in.' },
  { do: 'write', text: 'Observation: the level does not rise' },
  { do: 'say', text: 'So where did the sugar go?' },
  {
    do: 'ask',
    question: 'Where did the sugar go?',
    options: [
      { text: 'It melted into liquid', why: 'Melting would still add volume.' },
      {
        text: 'It slipped into spaces between water particles',
        correct: true,
        why: 'The gaps between particles hold it.',
      },
    ],
  },
];

const laid = layoutBeat({ id: 'a', topic: 'matter', narration: '', board } as ScriptBeat);

describe('what the ask puts on the board', () => {
  it('writes the question itself, ink ending in a question mark', () => {
    const written = laid.elements.filter(
      (el): el is Extract<Element, { kind: 'handwrite' }> => el.kind === 'handwrite',
    );
    expect(written.some((el) => el.text.includes('?'))).toBe(true);
  });

  it('lists the options, lettered, so a student can point at one', () => {
    const list = laid.elements.find((el) => el.kind === 'list') as Extract<
      Element,
      { kind: 'list' }
    >;
    expect(list).toBeDefined();
    expect(list.items).toHaveLength(2);
    expect(list.items.map((i) => i.term)).toEqual(['A', 'B']);
  });

  it('never puts the answer or the whys on the board before the student speaks', () => {
    const everything = JSON.stringify(laid.elements);
    expect(everything).not.toContain('gaps between particles hold');
    expect(everything).not.toContain('correct');
  });

  it('keeps question and options clear of everything else', () => {
    for (let i = 0; i < laid.elements.length; i += 1) {
      for (let j = i + 1; j < laid.elements.length; j += 1) {
        const a = laid.elements[i];
        const b = laid.elements[j];
        if (a.kind === 'mark' || b.kind === 'mark') continue;
        const boxA = boxOf(a);
        const boxB = boxOf(b);
        const overlap =
          boxA.x < boxB.x + boxB.w &&
          boxA.x + boxA.w > boxB.x &&
          boxA.y < boxB.y + boxB.h &&
          boxA.y + boxA.h > boxB.y;
        expect(overlap, `${a.id} over ${b.id}`).toBe(false);
      }
    }
  });
});

describe('what the ask tells the assembler', () => {
  it('marks which spoken moment holds the question', () => {
    expect(laid.asks).toHaveLength(1);
    expect(laid.asks[0].ask.question).toBe('Where did the sugar go?');
    // The second say (index 1 of the says) is the one that asks.
    expect(laid.asks[0].step).toBe(1);
  });

  it('marks nothing on a beat that never asks', () => {
    const plain = layoutBeat({
      id: 'p',
      topic: 't',
      narration: '',
      board: [
        { do: 'say', text: 'Just teaching.' },
        { do: 'write', text: 'A point' },
      ],
    } as ScriptBeat);
    expect(plain.asks).toEqual([]);
  });
});
