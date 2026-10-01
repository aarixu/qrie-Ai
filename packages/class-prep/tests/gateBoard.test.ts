import { describe, expect, it } from 'vitest';
import { PAGE_STRIDE, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { gateLesson, type MathsCheck } from '../src/gate';

/**
 * THREE FREE RULES ABOUT WHAT THE STUDENT CAN ACTUALLY SEE (canvas C0, item 5).
 *
 * The canvas audit (2026-10-01) replayed every kept class and found ink a
 * student never saw: answer lines below a 620-high board, one spoken line's
 * ink split over two pages while the camera showed one, and 2.7% of kept
 * elements never inside any frame the camera chose. None of it costs a model
 * call to catch, so the keep gate catches it.
 */

const noMaths: MathsCheck = () => ({ ok: true, failures: [] });
const hw = (id: string, x: number, y: number, text: string): Element => ({ kind: 'handwrite', id, x, y, text });
const lessonOf = (elements: Element[], beats: Lesson['beats']): Lesson =>
  ({ formatVersion: 1, id: 't', title: 'T', language: 'en', canvas: { w: 1000 + PAGE_STRIDE * 2, h: 620 }, elements, beats }) as Lesson;
const rules = (lesson: Lesson, rule: string) => gateLesson(lesson, { mathsCheck: noMaths }).filter((p) => p.rule === rule);

describe('ink stays on its page', () => {
  it('names the planner beat and the words that run off the bottom', () => {
    const lesson = lessonOf(
      [hw('b3_1', 400, 200, 'x = 3 - 2y'), hw('b3_2', 400, 700, 'So x = 49/29')],
      [{ id: 'b3_1', topic: 't', narration: 'Put y back.', show: ['b3_1', 'b3_2'] }],
    );
    const found = rules(lesson, 'on-board');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('Beat "b3"');
    expect(found[0].message).toContain('So x = 49/29');
  });

  it('passes ink on a later page of the endless board', () => {
    const lesson = lessonOf(
      [hw('b1_1', 400, 200, 'First page'), hw('b2_1', PAGE_STRIDE + 400, 200, 'Second page')],
      [
        { id: 'b1', topic: 't', narration: 'One.', show: ['b1_1'] },
        { id: 'b2', topic: 't', narration: 'Two.', show: ['b1_1', 'b2_1'] },
      ],
    );
    expect(rules(lesson, 'on-board')).toEqual([]);
  });
});

describe('one spoken line draws on one page', () => {
  it('fails a line whose new ink lands on two pages', () => {
    const lesson = lessonOf(
      [hw('b2_1', 400, 200, 'Left half'), hw('b2_2', PAGE_STRIDE + 400, 200, 'Right half')],
      [{ id: 'b2_1', topic: 't', narration: 'Both of these at once.', show: ['b2_1', 'b2_2'] }],
    );
    const found = rules(lesson, 'one-page');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('Beat "b2"');
    expect(found[0].message).toContain('Both of these at once.');
  });

  it('lets a later line carry on on the next page', () => {
    const lesson = lessonOf(
      [hw('b2_1', 400, 200, 'Left'), hw('b2_2', PAGE_STRIDE + 400, 200, 'Right')],
      [
        { id: 'b2_1', topic: 't', narration: 'This one.', show: ['b2_1'] },
        { id: 'b2_2', topic: 't', narration: 'Then this one.', show: ['b2_1', 'b2_2'] },
      ],
    );
    expect(rules(lesson, 'one-page')).toEqual([]);
  });
});

describe('everything is on camera at least once', () => {
  it('fails ink the camera never frames', () => {
    // The camera frames from the newest ink back, one page at most: shown
    // together with ink a page away, the far one is always out of frame.
    const lesson = lessonOf(
      [hw('b4_1', PAGE_STRIDE + 500, 300, 'Newest point'), hw('b4_2', 100, 560, 'Lost note')],
      [
        { id: 'b4_1', topic: 't', narration: 'Look here.', show: ['b4_2', 'b4_1'], frame: ['b4_1'] },
      ],
    );
    const found = rules(lesson, 'on-camera');
    expect(found.map((p) => p.where)).toEqual(['b4_2']);
    expect(found[0].message).toContain('Lost note');
  });

  it('passes ink that some moment frames', () => {
    const lesson = lessonOf(
      [hw('b4_1', 400, 300, 'Seen'), hw('b4_2', 500, 400, 'Also seen')],
      [{ id: 'b4_1', topic: 't', narration: 'Look.', show: ['b4_1', 'b4_2'] }],
    );
    expect(rules(lesson, 'on-camera')).toEqual([]);
  });
});
