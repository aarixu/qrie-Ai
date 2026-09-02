import { describe, expect, it } from 'vitest';
import { remembersASession } from '../src/save';
import type { Lesson } from '@ai-tutor/lesson-format';

/**
 * WHAT A LATER STUDENT WOULD READ, NOT JUST WHAT THEY WOULD HEAR.
 *
 * A Beat's board is a list of element IDS. Every word actually written on the
 * board lives in `lesson.elements`, which this guard did not look at for one
 * commit — so a note reading "Welcome back — last time we did the nucleus"
 * passed it, got cached, and greeted fifty students about a class they never
 * had. namesInSpine had always read the elements and said why; the new guard
 * beside it dropped the anchor.
 *
 * The other half is the opposite mistake. A guard that refuses too much is
 * silent in a different way: the topic is simply never cached, every future
 * student re-pays thirty to sixty seconds of prep, and nothing says why.
 */

const lesson = (over: Partial<Lesson> = {}): Lesson =>
  ({
    id: 'demo',
    title: 'The Nucleus',
    beats: [{ id: 'b1', narration: 'Inside every cell is a nucleus.', show: [] }],
    elements: [],
    ...over,
  }) as unknown as Lesson;

const withNote = (text: string) =>
  lesson({
    elements: [{ id: 'e1', kind: 'note', text }],
  } as unknown as Partial<Lesson>);

const withNarration = (narration: string) =>
  lesson({ beats: [{ id: 'b1', narration, show: [] }] } as unknown as Partial<Lesson>);

describe('a shared past written on the board', () => {
  it('is caught in a note, which no beat contains', () => {
    expect(remembersASession(withNote('Welcome back — last time we did the nucleus'))).not.toEqual(
      [],
    );
  });

  it('is caught in a title element', () => {
    const l = lesson({
      elements: [{ id: 'e1', kind: 'title', text: 'Picking up where we left off' }],
    } as unknown as Partial<Lesson>);
    expect(remembersASession(l)).not.toEqual([]);
  });

  it('is still caught in a narration', () => {
    expect(
      remembersASession(withNarration('Last time we did the nucleus, so today we go inside it.')),
    ).not.toEqual([]);
  });

  it('is caught in the lesson title itself', () => {
    expect(remembersASession(lesson({ title: 'Welcome back!' }))).not.toEqual([]);
  });
});

describe('ordinary teaching it must not refuse', () => {
  it('leaves "the last time YOU saw a rainbow" alone', () => {
    // A teacher reaching for something the student has lived is the best
    // opening there is, and it belongs in every copy of the class. "we" is
    // what claims a session; "time" plus "you" does not.
    expect(
      remembersASession(
        withNarration('The last time you saw a rainbow, you were looking at refraction.'),
      ),
    ).toEqual([]);
  });

  it('leaves "last week the moon was full" alone', () => {
    expect(remembersASession(withNarration('Last week the moon was full, and we can see why.'))).toEqual(
      [],
    );
  });

  it('leaves "welcome back to the world of numbers" alone', () => {
    // A flourish, not a memory. It greets the subject, not the person.
    expect(
      remembersASession(withNarration('Welcome back to the world of numbers, where nothing lies.')),
    ).toEqual([]);
  });

  it('still refuses "welcome back" greeting the person', () => {
    for (const line of ['Welcome back!', 'Welcome back, let us begin.', 'Welcome back to class.']) {
      expect(remembersASession(withNarration(line))).not.toEqual([]);
    }
  });

  it('leaves an ordinary class with no shared past alone', () => {
    expect(remembersASession(lesson())).toEqual([]);
  });
});
