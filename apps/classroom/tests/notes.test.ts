import { beforeEach, describe, expect, it } from 'vitest';
import { addNote, editNote, notesFor, notesStore, removeNote } from '../src/stores/notes';
import { bookmarksStore, isBookmarked, toggleBookmark } from '../src/stores/bookmarks';

/**
 * The two stores behind the library screens. Both hold a student's own record,
 * so the tests care most about what must never happen to it: a blank row, an
 * edit that touches the wrong note, or a lesson saved twice.
 *
 * The stores cache in memory, so each test resets through the store rather than
 * through localStorage.
 */

beforeEach(() => {
  localStorage.clear();
  notesStore.set([]);
  bookmarksStore.set([]);
});

const texts = () => notesStore.get().map((n) => n.text);

describe('notes: writing one down', () => {
  it('keeps the moment it was written at, not just the lesson', () => {
    addNote('class10-science-life-processes-autotrophic-nutrition', 'beat-arteries', 'valves stop the backflow');

    const [note] = notesStore.get();
    expect(note.lessonId).toBe('class10-science-life-processes-autotrophic-nutrition');
    expect(note.beatId).toBe('beat-arteries');
    expect(note.text).toBe('valves stop the backflow');
    expect(Number.isNaN(Date.parse(note.at))).toBe(false);
  });

  it('trims the text on the way in', () => {
    addNote('l1', 'b1', '   villi increase surface area \n');
    expect(texts()).toEqual(['villi increase surface area']);
  });

  it('refuses a blank note rather than storing an empty row', () => {
    addNote('l1', 'b1', '');
    addNote('l1', 'b1', '    ');
    addNote('l1', 'b1', '\n\t ');
    expect(notesStore.get()).toEqual([]);
  });

  it('stamps notes written in the same millisecond apart, so each stays its own row', () => {
    addNote('l1', 'b1', 'first');
    addNote('l1', 'b1', 'second');

    const [a, b] = notesStore.get();
    expect(a.at).not.toBe(b.at);
    expect(b.at > a.at).toBe(true);
  });

  it('keeps the newest 500 and drops the oldest', () => {
    for (let i = 0; i < 520; i += 1) addNote('l1', 'b1', `note ${i}`);

    const kept = notesStore.get();
    expect(kept).toHaveLength(500);
    expect(kept[0].text).toBe('note 20');
    expect(kept[499].text).toBe('note 519');
  });
});

describe('notes: changing one', () => {
  const write = () => {
    addNote('l1', 'b1', 'first');
    addNote('l1', 'b2', 'second');
    return notesStore.get();
  };

  it('rewrites in place, keeping the moment and the position', () => {
    const [first] = write();
    editNote(first.at, 'first, corrected');

    const after = notesStore.get();
    expect(texts()).toEqual(['first, corrected', 'second']);
    expect(after[0].at).toBe(first.at);
    expect(after[0].beatId).toBe('b1');
  });

  it('trims an edit and refuses a blank one', () => {
    const [first] = write();

    editNote(first.at, '  spaced out  ');
    expect(texts()).toEqual(['spaced out', 'second']);

    editNote(first.at, '   ');
    expect(texts()).toEqual(['spaced out', 'second']);
  });

  it('leaves every other note alone', () => {
    const [, second] = write();
    editNote(second.at, 'only this one');
    expect(texts()).toEqual(['first', 'only this one']);
  });

  it('ignores an edit to a note that is not there', () => {
    write();
    editNote('2020-01-01T00:00:00.000Z', 'from nowhere');
    expect(texts()).toEqual(['first', 'second']);
  });

  it('removes one note and nothing else', () => {
    const [first] = write();
    removeNote(first.at);
    expect(texts()).toEqual(['second']);

    removeNote(first.at);
    expect(texts()).toEqual(['second']);
  });
});

describe('notesFor', () => {
  it('returns one lesson, newest first, and nothing from the others', () => {
    addNote('heart', 'b1', 'heart one');
    addNote('blood', 'b1', 'blood one');
    addNote('heart', 'b2', 'heart two');

    expect(notesFor('heart').map((n) => n.text)).toEqual(['heart two', 'heart one']);
    expect(notesFor('blood').map((n) => n.text)).toEqual(['blood one']);
    expect(notesFor('respiration')).toEqual([]);
  });
});

describe('bookmarks', () => {
  it('saves a lesson and unsaves it again', () => {
    toggleBookmark('heart');
    expect(isBookmarked(bookmarksStore.get(), 'heart')).toBe(true);

    toggleBookmark('heart');
    expect(isBookmarked(bookmarksStore.get(), 'heart')).toBe(false);
    expect(bookmarksStore.get()).toEqual([]);
  });

  it('never holds two rows for one lesson, however often it is toggled', () => {
    for (let i = 0; i < 5; i += 1) toggleBookmark('heart');

    const saved = bookmarksStore.get();
    expect(saved).toHaveLength(1);
    expect(saved[0].lessonId).toBe('heart');
    expect(Number.isNaN(Date.parse(saved[0].at))).toBe(false);
  });

  it('touches only the lesson it was given', () => {
    toggleBookmark('heart');
    toggleBookmark('blood');
    toggleBookmark('heart');

    expect(bookmarksStore.get().map((b) => b.lessonId)).toEqual(['blood']);
    expect(isBookmarked(bookmarksStore.get(), 'heart')).toBe(false);
  });

  it('is false for a lesson nobody saved', () => {
    expect(isBookmarked([], 'heart')).toBe(false);
  });
});
