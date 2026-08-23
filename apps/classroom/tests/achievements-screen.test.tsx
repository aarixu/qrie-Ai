import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { formatDay } from '../src/lib/history';
import { Achievements } from '../src/screens/Achievements';
import { doubtLogStore, type DoubtEntry } from '../src/stores/doubtLog';
import { profileStore, type StudentProfile } from '../src/stores/profile';
import { progressStore, type Progress } from '../src/stores/progress';
import { quizHistoryStore, type QuizAttempt } from '../src/stores/quizHistory';

/**
 * The screen is wiring over lib/achievements: it writes the four stores and
 * renders. Every number asserted here is one the library derived — the screen
 * is never allowed to compute one of its own.
 *
 * renderToString runs no effects, so the lesson catalogue never resolves. That
 * is deliberate and is exactly the state a student sees offline: the chapter
 * achievement must stay out rather than appear at "0 of 0".
 */

const DAY_MS = 86_400_000;
const NOW = Date.now();

const day = (ago: number): string => new Date(NOW - ago * DAY_MS).toISOString().slice(0, 10);
const at = (ago: number): string => `${day(ago)}T10:00:00.000Z`;

const NO_PROFILE: StudentProfile = {
  name: null,
  klass: null,
  subjects: [],
  diagnostic: null,
  diagnosedAt: null,
};

const NOTHING: Progress = { lessons: {}, lastLessonId: null };

const finished = (...agos: number[]): Progress => ({
  lastLessonId: null,
  lessons: Object.fromEntries(
    agos.map((ago, i) => [`lesson-${i}`, { beatIndex: 0, completedAt: at(ago) }]),
  ),
});

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

const render = (screen: ReactElement): string =>
  decode(renderToString(<MemoryRouter>{screen}</MemoryRouter>));

const renderWith = (state: {
  progress?: Progress;
  doubts?: DoubtEntry[];
  quizzes?: QuizAttempt[];
  profile?: StudentProfile;
}): string => {
  progressStore.set(state.progress ?? NOTHING);
  doubtLogStore.set(state.doubts ?? []);
  quizHistoryStore.set(state.quizzes ?? []);
  profileStore.set(state.profile ?? NO_PROFILE);
  return render(<Achievements />);
};

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe('Achievements: a student who has started', () => {
  const html = renderWith({
    // Two lessons, yesterday and today: a run of two, not yet three.
    progress: finished(1, 0),
    doubts: [{ lessonId: 'class10-blood', beatId: 'hook', at: at(0) }],
    quizzes: [{ lessonRef: 'class10-blood', score: 7, total: 8, at: at(0) }],
  });

  it('counts how many of the catalogue have been earned', () => {
    expect(html).toContain('2 of 9 earned');
  });

  it('shows the earned ones with the day they were earned', () => {
    expect(html).toContain('First class finished');
    expect(html).toContain(`Earned ${formatDay(day(1))}`);
    expect(html).toContain('You raised your hand');
    expect(html).toContain('>Earned</h2>');
  });

  it('shows a locked one in full — its rule and how far off it is', () => {
    expect(html).toContain('>Not yet</h2>');
    expect(html).toContain('A perfect quiz');
    expect(html).toContain('Get every question right in one practice quiz.');
    expect(html).toContain('Best so far 7 of 8 in one quiz');
    expect(html).toContain('2 of 3 days in a row');
    expect(html).toContain('1 of 10 questions asked');
    expect(html).toContain('Placement test not taken yet');
  });

  it('draws one progress bar per locked achievement, and none for an earned one', () => {
    expect(countOf(html, 'role="progressbar"')).toBe(7);
    expect(html).toContain('aria-valuetext="2 of 3 days in a row"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toMatch(/width:\s*67%/);
  });

  it('puts the nearest locked one first', () => {
    expect(html.indexOf('Best so far 7 of 8 in one quiz')).toBeLessThan(
      html.indexOf('Placement test not taken yet'),
    );
  });

  it('leaves the chapter achievement out until the lesson list has loaded', () => {
    expect(html).not.toContain('Chapter finished');
    expect(html.toLowerCase()).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });
});

describe('Achievements: nothing has happened yet', () => {
  const html = renderWith({});

  it('names the nearest achievement and how to get it, instead of a wall of zeroes', () => {
    expect(html).toContain('Nothing earned yet');
    expect(html).toContain('First class finished');
    expect(html).toContain('Watch one class all the way to the end.');
    expect(html).toContain('Start a class');
  });

  it('draws no cards and no bars at all', () => {
    expect(countOf(html, 'role="progressbar"')).toBe(0);
    expect(html).not.toContain('>Not yet</h2>');
    expect(html).not.toContain('earned</div>');
  });

  it('leaves the empty state behind as soon as one question is asked', () => {
    const asked = renderWith({
      doubts: [{ lessonId: 'class10-blood', beatId: 'hook', at: at(0) }],
    });

    expect(asked).not.toContain('Nothing earned yet');
    expect(asked).toContain('1 of 9 earned');
  });
});

describe('Achievements: what this product does not have', () => {
  /**
   * There are no points, levels or leagues here, so the words may not appear —
   * the same line StreakDetail holds. Word boundaries rather than substrings,
   * so a legitimate word that happens to contain one of them is not banned.
   */
  const FORBIDDEN = [
    'point',
    'xp',
    'coin',
    'gem',
    'level',
    'league',
    'rank',
    'leaderboard',
    'freeze',
    'badge',
    'trophy',
    'reward',
  ];

  it('promises none of them, on a full screen or an empty one', () => {
    const full = renderWith({
      progress: finished(2, 1, 0),
      doubts: [{ lessonId: 'class10-blood', beatId: 'hook', at: at(0) }],
      quizzes: [
        { lessonRef: 'class10-blood', score: 5, total: 8, at: at(2) },
        { lessonRef: 'class10-blood', score: 8, total: 8, at: at(0) },
      ],
    }).toLowerCase();
    const empty = renderWith({}).toLowerCase();

    for (const word of FORBIDDEN) {
      const pattern = new RegExp(`\\b${word}s?\\b`);
      expect(full).not.toMatch(pattern);
      expect(empty).not.toMatch(pattern);
    }
  });
});
