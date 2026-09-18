import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chapter } from '../src/screens/Chapter';
import { Syllabus, forgetPrepStates } from '../src/screens/Syllabus';
import { profileStore } from '../src/stores/profile';
import { settingsStore } from '../src/stores/settings';
import { SYLLABI, forgetCatalog } from '../src/lib/content';

/**
 * A PREPARED TOPIC SHOULD NOT LOOK LIKE A COLD ONE.
 *
 * A cold topic costs about ninety-six seconds and about Rs 30 of somebody's
 * money to prepare; a prepared one opens at once; and a topic somebody else is
 * preparing RIGHT NOW is the one where starting your own is the pure waste the
 * prep lock exists to stop. Today every tile looks identical.
 *
 * The three assertions that matter, in order of what they cost if wrong:
 *
 *   1. AN OUTAGE MUST LOOK LIKE ABSENT, NEVER LIKE READY. prepStateOf answers
 *      null when the relay cannot say, and a badge that read null as ready
 *      would send a child to tap a class that is not there.
 *   2. The lookup is BATCHED. The route takes topicRefs plural; one request
 *      per tile is the shape that makes a catalogue unusable on a slow phone.
 *   3. The screen renders before the lookup answers.
 */

const roots: Root[] = [];
const calls: string[] = [];

/** What /api/prep/state answers, keyed by topicRef. Anything unlisted: absent. */
let states: Record<string, 'ready' | 'preparing' | 'absent'> = {};
/** When set, every prep/state call fails this way instead of answering. */
let prepFailure: 'http' | 'network' | 'hang' | null = null;

const MATHS = SYLLABI.find((s) => s.klass === 10 && s.subject === 'Mathematics')!;
const CHAPTER = MATHS.chapters[0];
const refOf = (topicId: string) => `${MATHS.id}/${CHAPTER.id}/${topicId}`;

const respond = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

const refsIn = (at: string): string[] =>
  decodeURIComponent(new URL(at, 'http://test.local').searchParams.get('topicRefs') ?? '')
    .split(',')
    .filter((r) => r !== '');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  // The catalogue is cached in a module, so without this the first test in the
  // file decides what every later one sees.
  forgetCatalog();
  // Answers are remembered across mounts on purpose (see ANSWER_TTL_MS), so
  // without this the first test in the file decides what every later one asks.
  forgetPrepStates();
  calls.length = 0;
  states = {};
  prepFailure = null;

  vi.stubGlobal('fetch', (url: string) => {
    const at = String(url);
    if (at.includes('/api/prep/state')) {
      calls.push(at);
      if (prepFailure === 'network') return Promise.reject(new TypeError('Failed to fetch'));
      if (prepFailure === 'hang') return new Promise<Response>(() => {});
      if (prepFailure === 'http') {
        return Promise.resolve(respond({ error: { message: 'we cannot answer this second' } }, 503));
      }
      const answer: Record<string, string> = {};
      for (const ref of refsIn(at)) answer[ref] = states[ref] ?? 'absent';
      return Promise.resolve(respond({ states: answer }));
    }
    // The catalogue. Empty on purpose: every topic is then COLD, which is the
    // only state where a badge changes what a student is told.
    return Promise.resolve(respond({ lessons: [] }));
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/** Let the catalogue, then the badge lookup, settle. */
async function settle(turns = 4): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function openChapter(): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/chapter/${MATHS.id}/${CHAPTER.id}`]}>
        <Routes>
          <Route path="/chapter/:syllabusId/:chapterId" element={<Chapter />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await settle();
  return host;
}

describe('a chapter tells a student which topics are ready', () => {
  it('marks a topic the relay says is ready', async () => {
    states = { [refOf(CHAPTER.topics[0].id)]: 'ready' };
    const host = await openChapter();
    expect(host.textContent).toContain('Ready now');
  });

  /**
   * THE MARK HAS TO BE DRAWN, NOT JUST SPELLED.
   *
   * `textContent` cannot see the difference between a glyph and the dot Icon
   * falls back to for a name its map does not have (ui/Icon.tsx:185), and the
   * first version of this badge shipped that dot: every "Ready now" in the app
   * read as a bullet, green and wrong, through a green suite. `data-icon` is
   * on the DOM for exactly this (Icon.tsx:196-205) — an <svg> means a glyph
   * was found, a <span> means it was not.
   */
  it('draws a real glyph beside each mark, not the missing-icon dot', async () => {
    states = {
      [refOf(CHAPTER.topics[0].id)]: 'ready',
      [refOf(CHAPTER.topics[1].id)]: 'preparing',
    };
    const host = await openChapter();
    for (const name of ['check_circle', 'hourglass_top']) {
      const drawn = host.querySelector(`[data-icon="${name}"]`);
      expect(drawn, name).not.toBeNull();
      expect(drawn!.tagName.toLowerCase(), name).toBe('svg');
    }
  });

  /**
   * A tile that is ready is an INVITATION, and dropping the words that say so
   * to make room for the badge trades one signal for another. Both fit on the
   * one line the tile already draws.
   */
  it('keeps the invitation to tap on a ready tile', async () => {
    states = { [refOf(CHAPTER.topics[0].id)]: 'ready' };
    const host = await openChapter();
    // Scoped to the ready tile itself: the other tiles in this chapter still
    // say "Start this class", so asserting over the whole screen would pass
    // without the ready one saying anything of the sort.
    const tile = [...host.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes(CHAPTER.topics[0].title),
    );
    expect(tile, CHAPTER.topics[0].title).toBeDefined();
    expect(tile!.textContent).toContain('Ready now');
    expect(tile!.textContent).toContain('Start this class');
  });

  it('marks a topic somebody else is preparing, and never calls that ready', async () => {
    states = { [refOf(CHAPTER.topics[0].id)]: 'preparing' };
    const host = await openChapter();
    expect(host.textContent).toContain('Being prepared');
    expect(host.textContent).not.toContain('Ready now');
  });

  it('gives an absent topic no badge at all — the default is no mark', async () => {
    const host = await openChapter();
    expect(host.textContent).not.toContain('Ready now');
    expect(host.textContent).not.toContain('Being prepared');
    // and the screen still says exactly what it says today
    expect(host.textContent).toContain('Start this class');
  });

  it('an outage renders exactly like absent, never like ready', async () => {
    states = { [refOf(CHAPTER.topics[0].id)]: 'ready' };
    for (const failure of ['http', 'network'] as const) {
      prepFailure = failure;
      const host = await openChapter();
      expect(host.textContent, failure).not.toContain('Ready now');
      expect(host.textContent, failure).not.toContain('Being prepared');
      expect(host.textContent, failure).toContain('Start this class');
    }
  });
});

describe('the slow phone', () => {
  it('asks once for the whole chapter, not once per tile', async () => {
    await openChapter();
    expect(calls).toHaveLength(1);
    expect(refsIn(calls[0])).toEqual(CHAPTER.topics.map((t) => refOf(t.id)));
  });

  it('renders every topic before the lookup answers', async () => {
    prepFailure = 'hang';
    const host = await openChapter();
    for (const topic of CHAPTER.topics) expect(host.textContent).toContain(topic.title);
    // No blocking spinner over the list: the tiles are tappable now.
    expect(host.querySelectorAll('button').length).toBeGreaterThanOrEqual(CHAPTER.topics.length);
  });

  /**
   * A BADGE ALREADY PAID FOR IS NOT WORTH PAYING FOR AGAIN.
   *
   * The answer map used to live only in component state, so every mount and
   * every accordion toggle re-issued the whole batch. That is not rupees —
   * /api/prep/state claims zero units — but `relay_usage` is keyed on the
   * student alone (0016_relay_control.sql:112), and the DEPLOYED claim_relay
   * tests the rate before it looks at units (0016_relay_control.sql:129) and
   * increments `window_count` even on a zero-unit claim (:169). Not
   * gate.ts:430, which is `createMemoryLedger`, the dev and test twin that
   * gate.ts:400 says is not usable in production. So badge
   * traffic spends the same 120-a-minute window a class start spends, and
   * `admitFree` exempts only 'report', only from halted/capped/budget, never
   * from rate (gate.ts:339-341). A child walking chapters should not be able
   * to rate-limit their own next class.
   */
  it('does not ask again for topics it has already been told about', async () => {
    states = { [refOf(CHAPTER.topics[0].id)]: 'ready' };
    await openChapter();
    expect(calls).toHaveLength(1);
    const host = await openChapter();
    expect(calls).toHaveLength(1);
    // and the badge is still shown, out of what was already answered
    expect(host.textContent).toContain('Ready now');
  });

  it('asks for nothing at all when there is nothing to ask about', async () => {
    // A chapter whose topics all have a lesson already has no cold tile, so a
    // request would buy nothing and cost a round trip.
    vi.stubGlobal('fetch', (url: string) => {
      const at = String(url);
      if (at.includes('/api/prep/state')) {
        calls.push(at);
        return Promise.resolve(respond({ states: {} }));
      }
      return Promise.resolve(
        respond({
          lessons: CHAPTER.topics.map((t, i) => ({
            id: `covered-${i}`,
            title: t.title,
            class: MATHS.klass,
            subject: MATHS.subject,
            path: `content/covered-${i}/lesson.json`,
            topicRef: refOf(t.id),
          })),
        }),
      );
    });
    await openChapter();
    expect(calls).toHaveLength(0);
  });
});

describe('the syllabus catalogue', () => {
  /** packages/relay/src/prep.ts MAX_PREP_STATE_REFS — a 51st ref fails all 51. */
  const MAX_REFS = 50;

  async function openSyllabus(klass: number, subject: string): Promise<HTMLElement> {
    settingsStore.set({ klass } as never);
    profileStore.set({ name: 'A', klass, subjects: [subject], diagnostic: null, diagnosedAt: null });
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <Syllabus />
        </MemoryRouter>,
      );
    });
    await settle(12);
    return host;
  }

  /**
   * The screen's copy of the route's ceiling, pinned to the route.
   *
   * A fifty-first ref does not get dropped — it 400s the whole request
   * (packages/relay/src/prep.ts:362), so every badge in that chunk is lost. A
   * lowered cap on the relay would break this silently and in the one
   * direction nobody looks at, so the two numbers are asserted equal here the
   * way refusal.test.ts asserts the five sentences.
   */
  it('chunks at exactly the number of refs the route accepts', () => {
    const at = path.join(process.cwd(), 'packages/relay/src/prep.ts');
    expect(existsSync(at), 'run vitest from the repo root').toBe(true);
    const found = /export const MAX_PREP_STATE_REFS = (\d+)/.exec(readFileSync(at, 'utf8'));
    expect(found, 'MAX_PREP_STATE_REFS in packages/relay/src/prep.ts').not.toBeNull();
    expect(Number(found![1])).toBe(MAX_REFS);
  });

  it('marks a chapter that has a ready topic in it', async () => {
    states = { [refOf(CHAPTER.topics[0].id)]: 'ready' };
    const host = await openSyllabus(10, 'Mathematics');
    expect(host.textContent).toContain('1 ready');
  });

  /**
   * Both marks, when there are both. The chapter line used to show the ready
   * count OR the preparing one, so a chapter with one ready topic and six
   * being prepared said "1 ready" and hid the six — which is the half that
   * tells a student not to start a seventh preparation.
   */
  it('shows the ready count and the preparing count together', async () => {
    states = {
      [refOf(CHAPTER.topics[0].id)]: 'ready',
      [refOf(CHAPTER.topics[1].id)]: 'preparing',
    };
    const host = await openSyllabus(10, 'Mathematics');
    expect(host.textContent).toContain('1 ready');
    expect(host.textContent).toContain('1 preparing');
  });

  /**
   * NOT ONE REF UNTIL THE CATALOGUE HAS SPOKEN.
   *
   * `useAsync` starts at 'loading' (lib/async.ts:51) and `dataOr` hands back
   * null for it, so on the first render NO topic has a lesson and every topic
   * in the open subject reads cold. Firing then asks about topics that are
   * already taught, and when the catalogue lands the ref list changes, the run
   * is cancelled and the whole batch goes out AGAIN — double the requests, on
   * the screen that opens first, and a badge that can appear and vanish in
   * between. A failed catalogue is the same trap with worse timing: every
   * topic cold means the MOST requests exactly when the network is already
   * proving unreliable, so it is gated on 'ready' rather than on 'not loading'.
   */
  it('asks about nothing while the catalogue is still loading', async () => {
    const taught = refOf(CHAPTER.topics[0].id);
    vi.stubGlobal('fetch', (url: string) => {
      const at = String(url);
      if (at.includes('/api/prep/state')) {
        calls.push(at);
        const answer: Record<string, string> = {};
        for (const ref of refsIn(at)) answer[ref] = states[ref] ?? 'absent';
        return Promise.resolve(respond({ states: answer }));
      }
      return Promise.resolve(
        respond({
          lessons: [
            {
              id: 'taught-0',
              title: CHAPTER.topics[0].title,
              class: MATHS.klass,
              subject: MATHS.subject,
              path: 'content/taught-0/lesson.json',
              topicRef: taught,
            },
          ],
        }),
      );
    });

    await openSyllabus(10, 'Mathematics');
    expect(calls.length).toBeGreaterThan(0);
    // A topic the catalogue already covers must never appear in a request:
    // its presence is proof the batch went out before the catalogue landed.
    for (const at of calls) expect(refsIn(at), at).not.toContain(taught);
  });

  it('never asks for more refs in one go than the route accepts', async () => {
    // Class 11 Biology is the big one: 241 topics over 19 chapters, which is
    // several requests, not one, and certainly not 241.
    const biology = SYLLABI.find((s) => s.klass === 11 && s.subject === 'Biology')!;
    const topics = biology.chapters.reduce((n, c) => n + c.topics.length, 0);
    await openSyllabus(11, 'Biology');
    // One request per chunk of fifty, and not one per tile: 241 topics is five
    // calls, not 241. This is the assertion the slow phone cares about.
    expect(calls).toHaveLength(Math.ceil(topics / MAX_REFS));
    for (const at of calls) {
      const n = refsIn(at).length;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(MAX_REFS);
    }
  });
});
