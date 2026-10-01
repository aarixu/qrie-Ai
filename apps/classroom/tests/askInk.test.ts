import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateLesson, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { withoutAskInk } from '../src/lib/askInk';

/**
 * CLASSES KEPT BEFORE 2026-10-01 WROTE THEIR QUESTIONS ON THE BOARD. Aarav:
 * when she asks, no question and no options appear. New classes write none
 * (board-layout); this takes them off the kept ones as they are played.
 */

const load = (path: string): Lesson => {
  const result = validateLesson(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.lesson;
};
const textOf = (el: Element | undefined): string => (el && 'text' in el && typeof el.text === 'string' ? el.text : '');
const bare = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[\s.?!:;,]+$/, '').trim();

describe('a kept class, played without its question ink', () => {
  const kept = load('content/class9-science-matter-in-our-surroundings-evaporation/lesson.json');
  const played = withoutAskInk(kept);
  const byId = new Map(played.elements.map((el) => [el.id, el]));

  it('shows no held moment its own question', () => {
    for (const beat of played.beats.filter((b) => b.ask)) {
      const question = bare(beat.ask!.question);
      for (const id of beat.show) expect(bare(textOf(byId.get(id))), `${beat.id} ${id}`).not.toBe(question);
    }
  });

  it('adds no ink with a question mark at the moment it asks, except a title', () => {
    played.beats.forEach((beat, n) => {
      if (!beat.ask) return;
      const before = new Set(n > 0 ? played.beats[n - 1].show : []);
      const fresh = beat.show.filter((id) => !before.has(id)).map((id) => byId.get(id));
      expect(fresh.filter((el) => el && el.kind !== 'title' && textOf(el).includes('?')), beat.id).toEqual([]);
    });
  });

  it('takes off questions and nothing else: the titles, the teaching and every beat stay', () => {
    expect(played.beats.map((b) => b.id)).toEqual(kept.beats.map((b) => b.id));
    expect(played.elements.some((el) => textOf(el) === 'Why Does Water Disappear?')).toBe(true);
    // A question asked earlier, outside any held moment, is teaching and stays.
    expect(played.elements.some((el) => textOf(el) === 'Why do we spread clothes wide to dry?')).toBe(true);
    const left = new Set(played.elements.map((el) => el.id));
    const gone = new Map<string, string[]>();
    for (const el of kept.elements.filter((e) => !left.has(e.id))) {
      const group = el.id.replace(/_l\d+$/, '');
      gone.set(group, [...(gone.get(group) ?? []), textOf(el)]);
    }
    // Measured on this class: its four asks, and the four reworded copies the
    // planner also wrote — eight questions, fifteen wrapped lines.
    expect(gone.size).toBe(8);
    for (const [group, lines] of gone) expect(lines.join(' ').trim(), group).toMatch(/\?$/);
  });

  it('leaves no beat pointing at ink that is gone', () => {
    for (const beat of played.beats) {
      for (const id of [...beat.show, ...(beat.frame ?? []), ...(beat.focus ?? []).map((f) => f.split('#')[0])]) {
        expect(byId.has(id), `${beat.id} ${id}`).toBe(true);
      }
    }
  });

  it('never changes the lesson it was given', () => {
    const again = load('content/class9-science-matter-in-our-surroundings-evaporation/lesson.json');
    expect(kept).toEqual(again);
  });
});

describe('a kept class with lettered options', () => {
  const lesson: Lesson = {
    formatVersion: 1,
    id: 'opts',
    title: 'Mass and weight',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [
      { kind: 'handwrite', id: 'b1_0', x: 300, y: 120, text: 'Weight depends on gravity' },
      { kind: 'handwrite', id: 'b1_1', x: 300, y: 200, text: 'Which one changes on the Moon?' },
      { kind: 'list', id: 'b1_2', x: 100, y: 240, w: 800, h: 120, items: [{ term: 'A', meaning: 'Mass' }, { term: 'B', meaning: 'Weight' }] },
    ],
    beats: [
      { id: 'b1', topic: 't', narration: 'Gravity pulls.', show: ['b1_0'], frame: ['b1_0'] },
      {
        id: 'b1_q',
        topic: 't',
        narration: 'Which one changes on the Moon?',
        show: ['b1_0', 'b1_1', 'b1_2'],
        frame: ['b1_1', 'b1_2'],
        ask: {
          question: 'Which one changes on the Moon?',
          options: [{ text: 'Mass', why: 'It is the matter itself.' }, { text: 'Weight', correct: true, why: 'Gravity is weaker.' }],
        },
      },
    ],
  } as Lesson;

  it('takes the question and its lettered options off, and frames what she taught', () => {
    const played = withoutAskInk(lesson);
    expect(played.elements.map((el) => el.id)).toEqual(['b1_0']);
    expect(played.beats[1].show).toEqual(['b1_0']);
    expect(played.beats[1].frame).toEqual(['b1_0']);
  });

  it('hands back the very lesson when there is nothing to take off', () => {
    const plain = { ...lesson, beats: [lesson.beats[0]], elements: [lesson.elements[0]] } as Lesson;
    expect(withoutAskInk(plain)).toBe(plain);
  });
});
