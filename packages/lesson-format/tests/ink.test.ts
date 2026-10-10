import { describe, expect, it } from 'vitest';
import { INK_NAMES, validateLesson, type Element, type Lesson } from '@ai-tutor/lesson-format';

const lessonWith = (el: Element): Lesson => ({
  formatVersion: 1,
  id: 'i',
  title: 'I',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [el],
  beats: [{ id: 'b1', topic: 't', narration: 'Look at the lacteal.', show: [el.id] }],
});

describe('ink', () => {
  it('names six colours, in a fixed order', () => {
    expect(INK_NAMES).toEqual(['red', 'blue', 'green', 'orange', 'purple', 'teal']);
  });

  it('may colour a name, its line, its mark and its notes item', () => {
    const els: Element[] = [
      { kind: 'handwrite', id: 'h', x: 100, y: 200, text: 'Lacteal', ink: 'green' },
      { kind: 'arrow', id: 'a', from: { x: 1, y: 2 }, to: { x: 30, y: 40 }, ink: 'green' },
      { kind: 'mark', id: 'm', x: 10, y: 10, w: 40, h: 40, shape: 'circle', ink: 'green' },
      { kind: 'list', id: 'l', x: 10, y: 10, w: 300, items: [{ term: 'Lacteal', meaning: 'takes fats', ink: 'green' }] },
    ];
    for (const el of els) expect(validateLesson(lessonWith(el)).ok).toBe(true);
  });

  it('refuses a colour the board does not have, and says which', () => {
    const bad = validateLesson(lessonWith({ kind: 'handwrite', id: 'h', x: 1, y: 2, text: 'Lacteal', ink: 'pink' as never }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join('\n')).toMatch(/ink must be one of red, blue, green, orange, purple, teal, got "pink"/);
    const item = validateLesson(
      lessonWith({ kind: 'list', id: 'l', x: 1, y: 2, w: 300, items: [{ term: 'Lacteal', ink: 'gold' as never }] }),
    );
    expect(item.ok).toBe(false);
  });

  it('leaves an element without ink exactly as valid as before', () => {
    expect(validateLesson(lessonWith({ kind: 'handwrite', id: 'h', x: 1, y: 2, text: 'Villi' })).ok).toBe(true);
  });
});
