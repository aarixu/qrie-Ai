import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { CALENDAR_DAYS, dayLabel, formatDay, streakBounds } from '../src/lib/history';
import { DoubtHistory } from '../src/screens/DoubtHistory';
import { StreakDetail } from '../src/screens/StreakDetail';
import { doubtLogStore, type DoubtEntry } from '../src/stores/doubtLog';
import { progressStore, type Progress } from '../src/stores/progress';

/**
 * Both screens read the two stores and nothing else, so the tests write the
 * stores and render. The ids in the fixtures come from the committed lesson
 * rather than being made up, which is the shape the doubt log really holds.
 *
 * renderToString runs no effects, so the catalog never resolves here — that is
 * deliberate. This is exactly the state a student sees offline or after a
 * lesson is withdrawn, and it is the state that must degrade to raw ids
 * instead of the word "undefined".
 */

const ROOT = process.cwd();
const NUTRITION = ((): Lesson => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'content/class10-nutrition/lesson.json'), 'utf8'),
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

/** Three questions over three days, on real beats of a real lesson. */
const LOG: DoubtEntry[] = [
  { lessonId: NUTRITION.id, beatId: NUTRITION.beats[2].id, at: at(4, '11:20:00') },
  { lessonId: NUTRITION.id, beatId: NUTRITION.beats[2].id, at: at(1, '19:05:00') },
  { lessonId: 'class10-respiration', beatId: 'hook', at: at(0, '08:30:00') },
];

const finishedOn = (...days: number[]): Progress => ({
  lastLessonId: NUTRITION.id,
  lessons: Object.fromEntries(
    days.map((d, i) => [`lesson-${i}`, { beatIndex: 0, completedAt: at(d, '10:00:00') }]),
  ),
});

const NOTHING: Progress = { lessons: {}, lastLessonId: null };

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

const renderDoubts = (log: DoubtEntry[]): string => {
  doubtLogStore.set(log);
  return render(<DoubtHistory />);
};

const renderStreak = (progress: Progress, log: DoubtEntry[]): string => {
  progressStore.set(progress);
  doubtLogStore.set(log);
  return render(<StreakDetail />);
};

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe('DoubtHistory: the log', () => {
  const html = renderDoubts(LOG);

  it('counts every question the student has asked', () => {
    expect(html).toContain('3 questions asked');
  });

  it('names the beat that drew the most questions, and how often', () => {
    expect(html).toContain(NUTRITION.beats[2].id);
    expect(html).toContain('2 times');
  });

  it('heads each day, newest first, in plain language', () => {
    const headings = [0, 1, 4].map((d) => dayLabel(dayAgo(d), new Date(NOW)));

    expect(headings[0]).toBe('Today');
    expect(headings[1]).toBe('Yesterday');
    expect(headings[2]).toBe(formatDay(dayAgo(4)));

    const positions = headings.map((label) => html.indexOf(`>${label}</h2>`));
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('renders one row per question', () => {
    expect(countOf(html, 'back_hand')).toBe(LOG.length + 1); // one per row, one in the summary
  });

  it('falls back to the raw ids while nothing has resolved the lesson', () => {
    expect(html).toContain(NUTRITION.id);
    expect(html).toContain('class10-respiration');
    expect(html).toContain('hook');
    expect(html.toLowerCase()).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('offers no way into a lesson it could not resolve', () => {
    // A row that cannot name its lesson must not pretend to be a link to it.
    expect(countOf(html, 'disabled=""')).toBe(LOG.length);
    expect(html).not.toContain('chevron_right');
  });

  it('says "question" in the singular for a student who asked once', () => {
    const single = renderDoubts([LOG[2]]);

    expect(single).toContain('1 question asked');
    expect(single).not.toContain('1 questions');
    expect(single).toContain('1 time');
    expect(single).not.toContain('1 times');
  });
});

describe('DoubtHistory: nothing asked yet', () => {
  const html = renderDoubts([]);

  it('encourages a first question instead of showing an empty list', () => {
    expect(html).toContain('No questions yet');
    expect(html).toContain('raise your hand');
    expect(html).toContain('Go to a class');
  });

  it('shows no summary and no day headings', () => {
    expect(html).not.toContain('questions asked');
    expect(html).not.toContain('Today');
    expect(html).not.toContain('Most about');
  });
});

describe('StreakDetail: an active student', () => {
  const progress = finishedOn(0, 1, 5, 6, 7, 8, 9);
  const bounds = streakBounds(progress, new Date(NOW));
  const html = renderStreak(progress, LOG);

  it('shows a record longer than the run going on now', () => {
    expect(bounds.current).toBe(2);
    expect(bounds.longest).toBe(5);
  });

  it('prints the current streak large and the record beside it', () => {
    expect(html).toContain(`>${bounds.current}</span>`);
    expect(html).toContain(`>${bounds.longest}</span>`);
    expect(html).toContain('Best ever');
    expect(html).toContain('days in a row');
  });

  it('draws one square per day of the twelve-week window', () => {
    expect(countOf(html, 'role="img"')).toBe(CALENDAR_DAYS);
  });

  it('gives every square an accessible title', () => {
    expect(countOf(html, 'aria-label="')).toBeGreaterThanOrEqual(CALENDAR_DAYS);
    expect(html).toContain(`aria-label="${formatDay(dayAgo(0))} — 1 lesson finished, 1 question asked"`);
    expect(html).toContain(`aria-label="${formatDay(dayAgo(2))} — nothing"`);
  });

  it('labels the three things a square can mean', () => {
    for (const label of ['Nothing yet', 'Asked a question', 'Finished a lesson']) {
      expect(html).toContain(label);
    }
  });

  it('explains in plain language what keeps the streak alive', () => {
    expect(html).toContain('How the streak works');
    expect(html).toContain('It counts days, not lessons.');
    expect(html).toContain(`Last lesson finished on ${formatDay(dayAgo(0))}.`);
  });

  it('promises nothing the product does not have', () => {
    for (const invented of ['freeze', 'league', 'gem', 'reward', 'badge', 'XP']) {
      expect(html.toLowerCase()).not.toContain(invented.toLowerCase());
    }
  });

  it('says "day in a row" in the singular', () => {
    const single = renderStreak(finishedOn(0), []);

    expect(single).toContain('day in a row');
    expect(single).not.toContain('days in a row');
  });
});

describe('StreakDetail: nothing finished yet', () => {
  const html = renderStreak(NOTHING, []);

  it('invites a first lesson instead of showing a streak of zero', () => {
    expect(html).toContain('No streak yet');
    expect(html).toContain('starts at one');
    expect(html).toContain('Start a class');
  });

  it('draws no grid at all', () => {
    expect(countOf(html, 'role="img"')).toBe(0);
    expect(html).not.toContain('Last 12 weeks');
  });

  it('still draws the grid for a student who has asked but not finished', () => {
    const asked = renderStreak(NOTHING, LOG);

    expect(asked).not.toContain('No streak yet');
    expect(countOf(asked, 'role="img"')).toBe(CALENDAR_DAYS);
    // Nothing was finished, so the honest last-active line is absent.
    expect(asked).not.toContain('Last lesson finished');
  });
});
