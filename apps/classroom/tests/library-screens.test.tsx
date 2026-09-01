import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { Notes } from '../src/screens/Notes';
import { Bookmarks } from '../src/screens/Bookmarks';
import { notesStore, type Note } from '../src/stores/notes';
import { bookmarksStore, type Bookmark } from '../src/stores/bookmarks';
import { progressStore, type Progress } from '../src/stores/progress';

/**
 * The two library screens read their stores and nothing else, so the tests
 * write the stores and render. The ids come from the committed lesson rather
 * than being made up, which is the shape the notes store really holds.
 *
 * renderToString runs no effects, so the catalog never resolves here — that is
 * deliberate. It is exactly the state a student sees offline or after a lesson
 * is withdrawn, and it is the state that must degrade to raw ids instead of the
 * word "undefined".
 */

const ROOT = process.cwd();
const NUTRITION = ((): Lesson => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'content/class10-science-life-processes-autotrophic-nutrition/lesson.json'), 'utf8'),
  ) as unknown;
  const result = validateLesson(raw);
  if (!result.ok) throw new Error(`the nutrition lesson is invalid: ${result.errors.join('; ')}`);
  return result.lesson;
})();

const DAY_MS = 86_400_000;
/** Captured once so the fixtures and the expected labels agree. */
const NOW = Date.now();

const dayAgo = (days: number): string => new Date(NOW - days * DAY_MS).toISOString().slice(0, 10);
const at = (days: number, clock: string): string => `${dayAgo(days)}T${clock}.000Z`;

/** Three notes over two lessons, on real beats of a real lesson. */
const NOTES: Note[] = [
  {
    lessonId: NUTRITION.id,
    beatId: NUTRITION.beats[1].id,
    text: 'saliva starts on starch, not on protein',
    at: at(3, '11:20:00'),
  },
  {
    lessonId: 'class10-respiration',
    beatId: 'hook',
    text: 'breathing is not the same thing as respiration',
    at: at(1, '19:05:00'),
  },
  {
    lessonId: NUTRITION.id,
    beatId: NUTRITION.beats[2].id,
    text: 'villi: more surface, more absorbed',
    at: at(0, '08:30:00'),
  },
];

const SAVED: Bookmark[] = [
  { lessonId: NUTRITION.id, at: at(4, '10:00:00') },
  { lessonId: 'class10-respiration', at: at(0, '09:00:00') },
];

const NOTHING_DONE: Progress = { lessons: {}, lastLessonId: null };
const NUTRITION_DONE: Progress = {
  lastLessonId: NUTRITION.id,
  lessons: { [NUTRITION.id]: { beatIndex: 0, completedAt: at(4, '10:30:00') } },
};

/** React escapes text on the way out; assertions read better against the source copy. */
const decode = (html: string): string =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Both screens sit in the Screen frame, which navigates — so they need a router. */
const render = (screen: ReactElement): string =>
  decode(renderToString(<MemoryRouter>{screen}</MemoryRouter>));

const renderNotes = (notes: Note[]): string => {
  notesStore.set(notes);
  return render(<Notes />);
};

const renderBookmarks = (saved: Bookmark[], progress: Progress): string => {
  bookmarksStore.set(saved);
  progressStore.set(progress);
  return render(<Bookmarks />);
};

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe('Notes: what the student wrote', () => {
  const html = renderNotes(NOTES);

  it('shows every note in the words the student wrote', () => {
    for (const note of NOTES) expect(html).toContain(note.text);
    expect(html).toContain('3 notes');
  });

  it('gathers notes under the lesson they came from, newest lesson first', () => {
    const nutrition = html.indexOf(NUTRITION.id);
    const respiration = html.indexOf('class10-respiration');

    expect(nutrition).toBeGreaterThan(-1);
    expect(respiration).toBeGreaterThan(-1);
    // The newest note of all is a nutrition note, so that group leads.
    expect(nutrition).toBeLessThan(respiration);
  });

  it('names the moment each note belongs to', () => {
    expect(countOf(html, 'my_location')).toBe(NOTES.length);
    expect(html).toContain(NUTRITION.beats[1].id);
    expect(html).toContain(NUTRITION.beats[2].id);
    expect(html).toContain('hook');
  });

  it('dates each note in plain language', () => {
    expect(html).toContain('Today');
    expect(html).toContain('Yesterday');
  });

  it('falls back to the raw ids while nothing has resolved the lesson', () => {
    expect(html.toLowerCase()).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('offers no way into a lesson it could not resolve', () => {
    // A note that cannot name its lesson must not pretend to link back into it.
    expect(html).not.toContain('Open the class');
    expect(html).not.toContain('play_circle');
  });

  it('lets every note be rewritten or thrown away', () => {
    expect(countOf(html, 'aria-label="Edit note"')).toBe(NOTES.length);
    expect(countOf(html, 'aria-label="Delete note"')).toBe(NOTES.length);
  });

  it('says "note" in the singular for a student who wrote one', () => {
    const single = renderNotes([NOTES[0]]);

    expect(single).toContain('1 note');
    expect(single).not.toContain('1 notes');
  });
});

describe('Notes: nothing written yet', () => {
  const html = renderNotes([]);

  it('explains where notes come from instead of showing an empty list', () => {
    expect(html).toContain('No notes yet');
    expect(html).toContain('the exact moment of the lesson');
    expect(html).toContain('Go to a class');
  });

  it('shows no headings and no controls', () => {
    expect(html).not.toContain('aria-label="Edit note"');
    expect(html).not.toContain('Today');
    expect(html.toLowerCase()).not.toContain('undefined');
  });
});

describe('Bookmarks: the lessons put aside', () => {
  const html = renderBookmarks(SAVED, NUTRITION_DONE);

  it('lists every saved lesson, newest save first', () => {
    expect(html).toContain('2 lessons');

    const respiration = html.indexOf('class10-respiration');
    const nutrition = html.indexOf(NUTRITION.id);
    expect(respiration).toBeGreaterThan(-1);
    expect(respiration).toBeLessThan(nutrition);
  });

  it('says which ones are finished, and claims nothing finer', () => {
    expect(countOf(html, 'Finished')).toBe(1);
    expect(countOf(html, 'Not finished yet')).toBe(1);
    for (const invented of ['%', 'halfway', 'in progress', 'badge']) {
      expect(html.toLowerCase()).not.toContain(invented.toLowerCase());
    }
  });

  it('falls back to the raw ids while nothing has resolved the catalog', () => {
    expect(html.toLowerCase()).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('offers no way into a lesson it could not resolve, but still lets it go', () => {
    expect(countOf(html, 'disabled=""')).toBe(SAVED.length);
    expect(html).not.toContain('chevron_right');
    expect(countOf(html, 'aria-label="Remove from saved"')).toBe(SAVED.length);
  });

  it('says "lesson" in the singular for a student who saved one', () => {
    const single = renderBookmarks([SAVED[0]], NOTHING_DONE);

    expect(single).toContain('1 lesson');
    expect(single).not.toContain('1 lessons');
    expect(single).toContain('Not finished yet');
    expect(single).not.toContain('check_circle');
  });
});

describe('Bookmarks: nothing saved yet', () => {
  const html = renderBookmarks([], NOTHING_DONE);

  it('explains where saved lessons come from', () => {
    expect(html).toContain('Nothing saved yet');
    expect(html).toContain('Save a class');
    expect(html).toContain('Find a class');
  });

  it('shows no rows at all', () => {
    expect(html).not.toContain('aria-label="Remove from saved"');
    expect(html).not.toContain('Not finished yet');
    expect(html.toLowerCase()).not.toContain('undefined');
  });
});
